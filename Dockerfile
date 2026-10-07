# syntax=docker/dockerfile:1
# ── Etapa 1: instalar dependencias y compilar TypeScript → dist/ ──
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# Compila y luego quita typescript/tsx/@types (no hacen falta en producción)
RUN npm run build && npm prune --omit=dev

# ── Etapa 2: runtime mínimo, sin compiladores ──
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./

# Nunca como root
USER node

# Long-polling de Telegram: sin puertos que exponer
CMD ["node", "dist/index.js"]
