# syntax=docker/dockerfile:1

# --- dependencies -------------------------------------------------------
# Copying only the manifests first keeps this layer cached across source
# edits: `npm ci` re-runs only when a package.json or the lockfile changes.
FROM node:26-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts

# --- build --------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build

# --- runtime ------------------------------------------------------------
FROM node:26-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only — no TypeScript, Vite, or test runner.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist

# The journal lives on a mounted volume, never in the image: every deploy
# replaces this filesystem, and DATA_DIR points outside it.
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3000
# Runs as root so the Fly volume (mounted root-owned) is writable without an
# entrypoint that chowns and drops privileges. The microVM is the boundary.
CMD ["node", "apps/api/dist/server.js"]
