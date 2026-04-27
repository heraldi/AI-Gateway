FROM node:20-alpine AS base
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

# ---- build (dashboard) ----
FROM node:20-alpine AS dashboard-build
WORKDIR /dashboard
COPY ../dashboard/package*.json ./
RUN npm ci
COPY ../dashboard ./
RUN npm run build

# ---- server build ----
FROM base AS server-build
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# ---- final ----
FROM base AS final
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=server-build /app/dist ./dist
COPY --from=dashboard-build /dashboard/dist ./dashboard/dist
COPY package*.json ./

RUN mkdir -p /data
ENV DB_PATH=/data/gateway.db
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "dist/index.js"]
