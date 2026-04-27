FROM node:20-alpine AS base
WORKDIR /app

# ── Install dashboard deps & build ──────────────────────────────────────────
FROM base AS dashboard-build
COPY dashboard/package*.json ./dashboard/
RUN cd dashboard && npm install
COPY dashboard ./dashboard
RUN cd dashboard && npm run build

# ── Install server deps & build ──────────────────────────────────────────────
FROM base AS server-build
COPY server/package*.json ./server/
COPY server/tsconfig.json ./server/
RUN cd server && npm install
COPY server/src ./server/src
RUN cd server && npm run build

# ── Production image ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Server runtime deps
COPY server/package*.json ./
RUN npm install --omit=dev

# Compiled server
COPY --from=server-build /app/server/dist ./dist

# Dashboard static build served by server
COPY --from=dashboard-build /app/dashboard/dist ./dashboard/dist

# Persistent data volume
RUN mkdir -p /data
ENV DB_PATH=/data/gateway.db
VOLUME ["/data"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
