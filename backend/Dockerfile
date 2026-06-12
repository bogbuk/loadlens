# Контекст сборки = backend/ (Coolify Base Directory = /backend, как у PriceLens).
# shared/ продублирован в backend/shared/ скриптом sync:shared, поэтому доступен здесь.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/shared ./shared
EXPOSE 3000
CMD ["node", "dist/main.js"]
