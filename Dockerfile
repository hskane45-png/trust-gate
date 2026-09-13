# Trust Gate — multi-stage Node 20 image for the Hono API
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY data ./data
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
ENV MOCK_MODE=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# Offline OFAC list + SOURCE.md (wallet soft-fails if missing; still ship it)
COPY data ./data

# Writable dir for optional .data/keys.json persistence (ephemeral fallback if FS fails)
RUN mkdir -p /app/.data && chown -R node:node /app
USER node

EXPOSE 8787
CMD ["node", "dist/index.js"]
