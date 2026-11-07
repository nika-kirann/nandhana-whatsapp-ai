FROM node:22.23.4-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git config --system url."https://github.com/".insteadOf ssh://git@github.com/
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && mkdir -p /data/auth && chown -R node:node /app /data
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts ./scripts
RUN npm run build
USER node
ENV NODE_ENV=production PORT=8000 AUTH_DIR=/data/auth
EXPOSE 8000
CMD ["node", "src/web-main.js"]
