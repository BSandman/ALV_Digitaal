# Dev/test/CI-image voor de ALV-app.
# LET OP: dit is GEEN productie-artefact. Productie = mijn.host .starter via SSH/rsync.
# Doel van deze image: dezelfde Node-major-versie als .starter, EEN proces, non-root.
#
# TE BEVESTIGEN: exacte Node-versie op .starter (voorstel §8, punt 2). Default = 20 LTS.

# ---- build/deps laag ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
# Alleen manifests eerst, voor cachebare install.
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# ---- runtime laag ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=development \
    PORT=3000
WORKDIR /app

# Minimale tini voor correcte signal-handling van EEN proces (geen cluster).
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Draai als non-root (pariteit met shared-hosting-gebruiker, veiliger).
USER node

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
# EEN Node-proces. Geen PM2, geen cluster-fork: spiegelt .starter.
CMD ["node", "src/server.js"]
