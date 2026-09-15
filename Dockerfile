# Wayline application image (ROADMAP G2.2). See "Run with containers" in README.md.
#
# The build stage installs every dependency and runs `npm run build` (typecheck, Vite and the
# service worker). The runtime stage keeps only production dependencies and the files the server
# reads at runtime: server/, shared/, the compiled standalone/ bundle and the PDF fonts in
# public/fonts/.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4174 \
    DATA_DIR=/var/lib/wayline/data \
    BACKUP_DIR=/var/lib/wayline/backups
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/standalone ./standalone
COPY --from=build /app/public/fonts ./public/fonts
RUN mkdir -p /var/lib/wayline/data /var/lib/wayline/backups \
    && chown -R node:node /var/lib/wayline
USER node
EXPOSE 4174
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4174) + '/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/server.mjs"]
