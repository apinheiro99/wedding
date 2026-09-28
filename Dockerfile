# syntax=docker/dockerfile:1
# One image, three roles: web (Next.js UI+API), worker (background jobs). Upload runs inside web.
FROM node:22-trixie-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg libheif-examples libheif1 libheif-plugin-libde265 libvips-tools ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN useradd -r -u 10001 app && mkdir -p /storage && chown app /storage
USER app
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]
