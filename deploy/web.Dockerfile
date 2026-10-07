# The public front door (docs/DEPLOY.md): the dashboard built for the live backend, served by Caddy.
# Build context: ./frontend. NETRA_HOST is baked into the build, because Vite inlines VITE_* at build time.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NETRA_HOST
RUN test -n "$NETRA_HOST" \
 && VITE_DATA_SOURCE=ws VITE_WS_URL="wss://$NETRA_HOST/ws" VITE_API_URL="https://$NETRA_HOST/api" npm run build

FROM caddy:2.8-alpine
COPY --from=build /app/dist /srv
