# Канонический Dockerfile для деплоя (Coolify: Base Directory = /, Build Pack = dockerfile).
# Контекст сборки — корень репо, чтобы в образ попали и backend/, и общий shared/.
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
