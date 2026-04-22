FROM node:22-alpine AS base
RUN npm install -g pnpm

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY tsconfig.base.json ./

RUN pnpm --filter @linkscope/shared build
RUN pnpm --filter @linkscope/api exec prisma generate
RUN pnpm --filter @linkscope/api build

FROM node:22-alpine AS runner
RUN npm install -g pnpm
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/package.json ./apps/api/

RUN mkdir -p /app/screenshots /app/uploads

# Install playwright browsers
RUN pnpm --filter @linkscope/api exec playwright install chromium --with-deps 2>/dev/null || true

WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/main"]
