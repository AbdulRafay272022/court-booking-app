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

# Built ON the deps stage (not a fresh image with only /workspace/node_modules
# copied in): npm places two Tailwinds in this workspace -- mobile's NativeWind
# needs 3.x, hoisted to the root node_modules, while the web app's 4.x is
# nested at apps/web/node_modules (see package-lock.json). Copying only the
# root node_modules silently dropped the nested one, so `next build` resolved
# Tailwind 3.x (no index.css) and failed with "Can't resolve 'tailwindcss'".
# This only ever passed locally because, with no .dockerignore, COPY apps/web
# swept in the host's untracked apps/web/node_modules; a clean CI checkout has
# no such directory. Basing on deps carries every nested node_modules along,
# and ../.dockerignore keeps host node_modules out so local == CI.
FROM deps AS builder
COPY apps/web ./apps/web
COPY packages/types ./packages/types
COPY packages/api-client ./packages/api-client
# NEXT_PUBLIC_* values are INLINED INTO THE CLIENT BUNDLE at `next build`
# time -- setting them on the running container's environment does nothing
# for code that runs in the browser (lib/config.ts is used by client
# components). An earlier version of this comment claimed runtime-only,
# which shipped an image whose browser code would call http://localhost:8000.
# The value is public (it's visible in every browser's network tab), so a
# build ARG is appropriate -- the deploy workflow passes vars.API_BASE_URL.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
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
