# Multi-stage build. better-sqlite3 has a native binding, so the build
# (npm ci + npm run build) must run inside this Linux container rather than
# being copied in from the host — otherwise the compiled binary won't match
# the deploy target's platform.
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app

# node_modules (not just .output) is included so `npm run db:init` can still
# be run inside the container via `fly ssh console` when the data volume is
# first provisioned.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/schema.sql ./schema.sql
COPY --from=build /app/scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
