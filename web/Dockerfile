FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S shennong && adduser -S shennong -G shennong
COPY --from=build --chown=shennong:shennong /app/.next/standalone ./
COPY --from=build --chown=shennong:shennong /app/.next/static ./.next/static
USER shennong
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/catalog >/dev/null || exit 1
CMD ["node", "server.js"]
