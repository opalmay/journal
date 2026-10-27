import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { SESSION_COOKIE, isSessionValid, secretsMatch } from "../auth.js";
import {
  OAUTH_SCOPE,
  clientSecretValid,
  consentToken,
  createAuthCode,
  deleteClient,
  getClient,
  redeemAuthCode,
  refreshTokens,
  registerClient,
  type OAuthClient,
  type TokenSet,
} from "../oauth.js";

// A minimal OAuth 2.1 authorization server so claude.ai can connect to /mcp:
// discovery metadata, dynamic client registration, a consent page behind the
// normal password login, and the code (PKCE S256 only) and refresh grants.

/** Where the server is reached from outside; trustProxy makes this honest on Fly. */
export function baseUrl(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

export function resourceMetadataUrl(request: FastifyRequest): string {
  return `${baseUrl(request)}/.well-known/oauth-protected-resource/mcp`;
}

const RegisterInput = z.object({
  client_name: z.string().trim().min(1).max(100).optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  token_endpoint_auth_method: z
    .enum(["none", "client_secret_post", "client_secret_basic"])
    .default("none"),
});

const AuthorizeParams = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  response_type: z.string(),
  code_challenge: z.string().min(43).max(128).optional(),
  code_challenge_method: z.string().optional(),
  state: z.string().max(1000).optional(),
  scope: z.string().optional(),
  resource: z.string().optional(),
});
type AuthorizeParams = z.infer<typeof AuthorizeParams>;

const TokenInput = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1),
    redirect_uri: z.string().min(1),
    code_verifier: z.string().min(43).max(128),
    client_id: z.string().optional(),
    client_secret: z.string().optional(),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1),
    client_id: z.string().optional(),
    client_secret: z.string().optional(),
  }),
]);

/** https anywhere, plain http only back to this machine (desktop clients). */
function acceptableRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function sessionId(request: FastifyRequest, app: FastifyInstance): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  const unsigned = raw ? request.unsignCookie(raw) : null;
  const id = unsigned?.valid ? unsigned.value : null;
  return id && isSessionValid(app.db, id) ? id : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(reply: FastifyReply, status: number, body: string) {
  return reply
    .code(status)
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .header("x-frame-options", "DENY")
    .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http:; frame-ancestors 'none'")
    .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>journal</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #24273a; color: #cad3f5;
         font: 14px/1.5 system-ui, sans-serif; }
  main { max-width: 22rem; padding: 0 1.5rem; }
  h1 { font-size: 1.1rem; color: #c6a0f6; margin: 0 0 .25rem; }
  p { color: #a5adcb; }
  code { color: #91d7e3; word-break: break-all; }
  .row { display: flex; gap: .5rem; margin-top: 1rem; }
  button { flex: 1; padding: .5rem; border-radius: .5rem; border: 1px solid #494d64; background: #363a4f;
           color: #cad3f5; font: inherit; cursor: pointer; }
  button[value=allow] { background: #c6a0f6; border-color: #c6a0f6; color: #181926; font-weight: 600; }
</style></head><body><main>${body}</main></body></html>`);
}

function errorPage(reply: FastifyReply, message: string) {
  return page(reply, 400, `<h1>journal</h1><p>${escapeHtml(message)}</p>`);
}

function redirectWith(reply: FastifyReply, redirectUri: string, params: Record<string, string | undefined>) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  return reply.redirect(url.toString(), 302);
}

type Checked =
  | { ok: true; params: AuthorizeParams; client: OAuthClient }
  | { ok: false; send: (reply: FastifyReply) => FastifyReply };

/**
 * Validates an authorize request. Until the client and redirect_uri check out,
 * errors are shown here; after that they go back to the client, per RFC 6749.
 */
function checkAuthorize(app: FastifyInstance, input: unknown): Checked {
  const parsed = AuthorizeParams.safeParse(input);
  if (!parsed.success) {
    return { ok: false, send: (r) => errorPage(r, "This sign-in link is incomplete.") };
  }
  const params = parsed.data;
  const client = getClient(app.db, params.client_id);
  if (!client) return { ok: false, send: (r) => errorPage(r, "Unknown application.") };
  if (!client.redirectUris.includes(params.redirect_uri)) {
    return { ok: false, send: (r) => errorPage(r, "The return address does not match this application.") };
  }
  const fail = (error: string, description: string): Checked => ({
    ok: false,
    send: (r) =>
      redirectWith(r, params.redirect_uri, { error, error_description: description, state: params.state }),
  });
  if (params.response_type !== "code") return fail("unsupported_response_type", "only code is supported");
  if (!params.code_challenge || params.code_challenge_method !== "S256") {
    return fail("invalid_request", "PKCE with S256 is required");
  }
  return { ok: true, params, client };
}

function tokenResponse(reply: FastifyReply, tokens: TokenSet) {
  return reply.header("cache-control", "no-store").send({
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: OAUTH_SCOPE,
  });
}

/** Client credentials may come as HTTP Basic or in the form body. */
function clientCredentials(
  request: FastifyRequest,
  body: { client_id?: string; client_secret?: string },
): { id?: string; secret?: string } {
  const header = request.headers.authorization;
  if (header?.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString();
    const i = decoded.indexOf(":");
    if (i > 0) {
      return {
        id: decodeURIComponent(decoded.slice(0, i)),
        secret: decodeURIComponent(decoded.slice(i + 1)),
      };
    }
  }
  return { id: body.client_id, secret: body.client_secret };
}

export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app;

  // The token endpoint and the consent form both post form-encoded bodies.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  // RFC 9728. Clients try the path-suffixed form first, then the bare one.
  const protectedResource = async (request: FastifyRequest) => ({
    resource: `${baseUrl(request)}/mcp`,
    authorization_servers: [baseUrl(request)],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
  });
  app.get("/.well-known/oauth-protected-resource", protectedResource);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResource);

  // RFC 8414.
  app.get("/.well-known/oauth-authorization-server", async (request) => {
    const base = baseUrl(request);
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      scopes_supported: [OAUTH_SCOPE],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    };
  });

  // RFC 7591 dynamic registration. Registering grants nothing by itself: every
  // client still has to get through the consent page, behind the password.
  app.post(
    "/oauth/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = RegisterInput.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_client_metadata" });
      }
      const input = parsed.data;
      if (!input.redirect_uris.every(acceptableRedirect)) {
        return reply.code(400).send({ error: "invalid_redirect_uri" });
      }
      const { client, secret } = registerClient(db, {
        name: input.client_name ?? "MCP client",
        redirectUris: input.redirect_uris,
        confidential: input.token_endpoint_auth_method !== "none",
      });
      return reply.code(201).send({
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: input.token_endpoint_auth_method,
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      });
    },
  );

  app.get("/oauth/authorize", async (request, reply) => {
    const checked = checkAuthorize(app, request.query);
    if (!checked.ok) return checked.send(reply);
    const { params, client } = checked;

    const session = sessionId(request, app);
    if (!session) {
      return reply.redirect(`/login?next=${encodeURIComponent(request.url)}`, 302);
    }

    const hidden = Object.entries({ ...params, csrf: consentToken(config.SESSION_SECRET, session) })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtml(String(value))}">`)
      .join("");
    const returnHost = new URL(params.redirect_uri).host;
    return page(
      reply,
      200,
      `<h1>Connect ${escapeHtml(client.name)}?</h1>
<p>It will be able to read your journal: entries, tags, mood, sleep and the other daily values. It cannot change anything.</p>
<p>You will be sent back to <code>${escapeHtml(returnHost)}</code>.</p>
<form method="post" action="/oauth/authorize">${hidden}
<div class="row"><button name="decision" value="deny">Deny</button><button name="decision" value="allow" autofocus>Allow</button></div>
</form>`,
    );
  });

  app.post(
    "/oauth/authorize",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, string>;
      const session = sessionId(request, app);
      if (!session || !secretsMatch(body.csrf ?? "", consentToken(config.SESSION_SECRET, session))) {
        return errorPage(reply, "This page expired. Start connecting again from the app.");
      }
      const checked = checkAuthorize(app, body);
      if (!checked.ok) return checked.send(reply);
      const { params } = checked;

      if (body.decision !== "allow") {
        return redirectWith(reply, params.redirect_uri, { error: "access_denied", state: params.state });
      }
      const code = createAuthCode(db, {
        clientId: params.client_id,
        redirectUri: params.redirect_uri,
        codeChallenge: params.code_challenge!,
      });
      return redirectWith(reply, params.redirect_uri, {
        code,
        state: params.state,
        iss: baseUrl(request),
      });
    },
  );

  app.post(
    "/oauth/token",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = TokenInput.safeParse(request.body);
      if (!parsed.success) {
        const grant = (request.body as { grant_type?: unknown } | null)?.grant_type;
        const known = grant === "authorization_code" || grant === "refresh_token";
        return reply.code(400).send({ error: known ? "invalid_request" : "unsupported_grant_type" });
      }
      const input = parsed.data;
      const creds = clientCredentials(request, input);
      if (!creds.id || !clientSecretValid(db, creds.id, creds.secret)) {
        return reply.code(401).send({ error: "invalid_client" });
      }

      const tokens =
        input.grant_type === "authorization_code"
          ? redeemAuthCode(db, {
              code: input.code,
              clientId: creds.id,
              redirectUri: input.redirect_uri,
              codeVerifier: input.code_verifier,
            })
          : refreshTokens(db, input.refresh_token, creds.id);
      if (!tokens) return reply.code(400).send({ error: "invalid_grant" });
      return tokenResponse(reply, tokens);
    },
  );

  // Revoking from Settings; behind the session gate like the rest of /api.
  app.delete("/api/oauth/clients/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!deleteClient(db, id)) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
