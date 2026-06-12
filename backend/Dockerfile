# ВАЖНО: контекст сборки = КОРЕНЬ репозитория (dat.com/), не backend/.
# Нужно, чтобы в образ попал общий shared/ (markets.seed.json и т.п.).
# В Coolify: Base Directory = / , Dockerfile Location = backend/Dockerfile.
FROM node:20-alpine AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
COPY shared/ ./shared/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/shared ./shared
EXPOSE 3000
CMD ["node", "dist/main.js"]
