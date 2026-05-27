FROM node:22-alpine

WORKDIR /app

# wget is in busybox by default; tini gives us a proper PID 1 for SIGTERM;
# tzdata makes the full IANA zone database (e.g. Australia/Sydney) available so
# Node, cron, and any future child process honour the TZ env var consistently.
RUN apk add --no-cache tini tzdata

COPY package.json package-lock.json .npmrc ./
# node:22-alpine bundles npm 10.x but package.json requires >=11.10.0 (engine-strict).
# We inline the install steps instead of `npm run setup` to skip `npm audit
# signatures` at build time — it re-queries the registry and enforces
# min-release-age=3, which blocks freshly-published deps (e.g. just after
# cutting a new fetchtv release). Run `npm run audit:signatures` (or `npm
# run setup`) on the host after the lockfile's newest dep ages past the
# threshold; the lockfile's integrity hashes still verify package contents
# during `npm ci`.
RUN npm install -g npm@11.15.0 \
 && npm ci --ignore-scripts \
 && npm run rebuild:natives

COPY . .

# /config is bind-mounted at runtime. Create it so the container can boot even
# if the host directory is empty on first run.
RUN mkdir -p /config

EXPOSE 8124

# Healthcheck hits the in-process /healthz endpoint. wget is provided by busybox.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8124/healthz || exit 1

# tini handles signals and reaps the migrate child; entrypoint runs migrations
# before exec'ing the server.
ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]
