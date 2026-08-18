# Stage 1 builds the client bundle with the full toolchain.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vite.config.ts ./
COPY shared ./shared
COPY client ./client
RUN pnpm build

# Stage 2 keeps only what the server needs at runtime.
FROM node:24-alpine AS runtime
RUN corepack enable
WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY tsconfig.json ./
COPY shared ./shared
COPY server ./server
COPY --from=build /app/dist ./dist

EXPOSE 8787

# No --env-file here: a container takes its configuration from the environment,
# and server/env.ts refuses to start if anything is missing.
CMD ["pnpm", "exec", "tsx", "server/main.ts"]
