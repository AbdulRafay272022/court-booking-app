# Build context must be the WORKSPACE ROOT (court-booking-frontend/), not
# this directory -- this is an npm workspaces monorepo (apps/web depends on
# packages/types and packages/api-client, raw-TS workspace packages with no
# build step of their own), so `npm ci` has to run where the root
# package.json/package-lock.json live for workspace linking to resolve.
# e.g.: docker build -f apps/web/Dockerfile -t <tag> .   (from court-booking-frontend/)

FROM node:20-slim AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/api-client/package.json packages/api-client/package.json
# npm workspaces needs every workspace's package.json present to resolve
# the lockfile correctly, even though this image only ever builds/runs
# apps/web -- apps/mobile's own image (if one ever exists) is unrelated.
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/web ./apps/web
COPY packages/types ./packages/types
COPY packages/api-client ./packages/api-client
# The web app's actual public API base URL is read at runtime from
# NEXT_PUBLIC_API_BASE_URL (see apps/web/lib/api.ts) via the container's
# environment, not baked in at build time -- no ARG/build-time secret needed.
RUN npm run build --workspace=@court-booking/web

# `output: "standalone"` (next.config.ts) traces only the files this app
# actually needs into .next/standalone, including a minimal node_modules --
# copying just that instead of the full dev node_modules tree is what keeps
# this final image small.
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/.next/standalone ./
# server.js resolves both of these relative to its own directory
# (apps/web/), not the image root -- a monorepo-standalone-build gotcha,
# confirmed by inspecting the actual .next/standalone output structure
# rather than assuming the single-app-repo layout most Docker examples show.
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/web/.next/static ./apps/web/.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
