FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/adapters/package.json packages/adapters/
COPY packages/rules/package.json packages/rules/
COPY packages/notifications/package.json packages/notifications/
COPY packages/database/package.json packages/database/
COPY packages/observability/package.json packages/observability/
COPY packages/services/package.json packages/services/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/worker apps/worker
COPY packages packages
RUN pnpm --filter @easypws/worker... build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]
