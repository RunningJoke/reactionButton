# ReactPod platform API. Build from the repository root (needs packages/ and firmware/data/prog/lib):
#   docker build -f platform/Dockerfile -t reactpod-platform .
FROM node:22-alpine AS build
WORKDIR /repo
COPY packages/program-model/package.json packages/program-model/
COPY platform/package.json platform/package-lock.json platform/
RUN cd platform && npm ci --no-audit --no-fund
COPY packages/program-model/src packages/program-model/src
COPY platform platform
RUN cd platform && npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 SHIPPED_DATA_DIR=/app/data MIGRATIONS_DIR=/app/migrations
WORKDIR /app
# esbuild bundles everything into dist/main.js; no node_modules needed at runtime
COPY --from=build /repo/platform/dist ./dist
COPY --from=build /repo/platform/dist-migrate ./dist-migrate
COPY platform/migrations ./migrations
COPY firmware/data/prog/lib ./data/prog/lib
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
