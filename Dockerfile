# syntax=docker/dockerfile:1

# Builds the Angular app and the API, then runs both from one origin on port 3000:
#   docker compose up --build          (reads META_MODEL_API_KEY from your shell or .env)
# Without a key, everything but reading your own documents works: on-device redaction, /demo
# and the sample patient, whose recorded Meta answers (api/samples) are replayed at no cost.

FROM node:24-bookworm-slim AS build
WORKDIR /app

# Dependencies first, so code changes don't reinstall them.
# The browser build needs no install scripts (they only fetch native ONNX binaries for Node).
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY api/package.json api/package-lock.json api/
RUN npm --prefix api ci --no-audit --no-fund

COPY . .
RUN npx ng build \
  && npm --prefix api run build \
  && npm --prefix api prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build /app/dist/carryover-labs/browser ./dist/carryover-labs/browser
COPY --from=build /app/api/package.json ./api/package.json
COPY --from=build /app/api/node_modules ./api/node_modules
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/api/samples ./api/samples
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "api/dist/main.js"]
