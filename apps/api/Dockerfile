FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/adapters/package.json packages/adapters/
COPY packages/rules/package.json packages/rules/
COPY packages/notifications/package.json packages/notifications/
COPY packages/database/package.json packages/database/
COPY packages/observability/package.json packages/observability/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages packages
RUN pnpm --filter @easypws/api... build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
