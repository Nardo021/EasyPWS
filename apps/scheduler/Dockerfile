FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/scheduler/package.json apps/scheduler/
COPY packages/contracts/package.json packages/contracts/
COPY packages/observability/package.json packages/observability/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/scheduler apps/scheduler
COPY packages packages
RUN pnpm --filter @easypws/scheduler... build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/scheduler
CMD ["node", "dist/main.js"]
