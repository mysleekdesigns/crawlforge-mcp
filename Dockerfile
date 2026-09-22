# Multi-stage Dockerfile for CrawlForge MCP Server
# Optimized for security, performance, and minimal image size
#
# ─── Why Debian (glibc) and not Alpine (musl) ────────────────────────────────
# The Camoufox stealth engine is a prebuilt Firefox downloaded from
# github.com/daijro/camoufox. It is dynamically linked against glibc:
# camoufox-bin declares PT_INTERP /lib/ld-linux-aarch64.so.1 (x86_64:
# /lib64/ld-linux-x86-64.so.2) and needs versioned GLIBC_2.17 … GLIBC_2.28
# symbols — measured directly from camoufox-152.0.4-beta.30-lin.arm64.zip on
# 2026-09-21. Alpine's musl cannot load that binary at all (it fails with a
# bare "not found"), so the previous node:20-alpine base could never run
# `engine: "camoufox"`.
#
# StealthBrowserManager now defaults to engine 'auto', which PREFERS Camoufox,
# so the deployed image has to be glibc-based. bookworm ships glibc 2.36.
# Upstream's own Docker notes say Ubuntu 22.04 (glibc 2.35); Debian 12 is the
# same family.
#
# ─── Why Node 22 and not Node 20 ─────────────────────────────────────────────
# `camoufox` is an OPTIONAL dependency, and one of its transitive deps —
# language-tags@2.1.0 — declares engines.node ">=22". npm does not warn for an
# optional dependency whose subtree fails an engine check: it silently drops the
# whole subtree. Measured 2026-09-21 with this repo's own package-lock.json:
#     node:20-bookworm-slim -> 508 packages, node_modules/camoufox ABSENT
#     node:22-bookworm-slim -> camoufox INSTALLED
# On node:20 the image therefore built "successfully" with no Camoufox in it and
# no error anywhere in the log. package.json still declares engines.node
# ">=20.16.0", so npm users on Node 20 hit the same silent gap — see the report
# accompanying this change; fixing that is a manifest decision, not a Dockerfile
# one.

# Build stage
FROM node:22-bookworm-slim AS builder

# Set working directory
WORKDIR /app

# Install build dependencies (native addons: node-gyp needs python3 + a toolchain)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci && \
    npm cache clean --force

# Copy source code
COPY . .

# Remove unnecessary files
RUN rm -rf \
    tests/ \
    docs/ \
    examples/ \
    .github/ \
    .git/ \
    *.md \
    .gitignore \
    .env.example \
    tasks/

# ─── Browser runtime dependencies, shared by the development and production ──
# stages. Split out so the two stages cannot drift apart.
#
# Xvfb is REQUIRED, not optional. On Linux, StealthBrowserManager launches
# Camoufox with `headless: 'virtual'` instead of true headless: the camoufox
# client then spawns `Xvfb` (it resolves it with `which Xvfb` and execs it) and
# runs a real, windowed Firefox inside that virtual display. Camoufox in Docker
# is reported to fail Cloudflare Turnstile consistently in true-headless mode
# (daijro/camoufox#574); virtual headless is the mitigation. Without the xvfb
# package below, every Camoufox launch in this image dies with
# "Please install Xvfb to use headless mode."
#
# The X/GTK libraries are Firefox's own DT_NEEDED list, read out of
# camoufox-152's libxul.so. Most are also pulled in by `chromium`, but they are
# listed explicitly because Camoufox — not Chromium — is what needs them, and a
# future change to the chromium package must not silently remove them.
FROM node:22-bookworm-slim AS browser-base

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    ca-certificates \
    fonts-liberation \
    fonts-dejavu-core \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo-gobject2 \
    libcairo2 \
    libdbus-1-3 \
    libdrm2 \
    libegl1 \
    libfontconfig1 \
    libfreetype6 \
    libgbm1 \
    libgdk-pixbuf-2.0-0 \
    libgl1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnotify4 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libsecret-1-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user. The home directory is load-bearing: camoufox@0.1.19
# resolves its browser from `os.homedir() + /.cache/camoufox` with NO env
# override (the CAMOUFOX_INSTALL_DIR variable only exists in the separate
# camoufox-js client), so the binary has to live under this user's home and
# HOME has to be set for the runtime user.
RUN groupadd -g 1001 mcp && \
    useradd -u 1001 -g mcp -m -d /home/mcp -s /usr/sbin/nologin mcp

# Development stage
FROM browser-base AS development

# Development-only tooling
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    bash \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies)
RUN npm ci && npm cache clean --force

# Copy source code
COPY --chown=mcp:mcp . .

# Create necessary directories
RUN mkdir -p /app/cache /app/logs && \
    chown -R mcp:mcp /app/cache /app/logs

# The Camoufox browser is NOT baked into the development image (it is ~1.3 GB
# extracted). Fetch it on demand inside the container:
#     docker compose exec -u mcp crawlforge-dev npx camoufox fetch
# docker-compose.yml mounts a named volume at /home/mcp/.cache/camoufox so that
# download survives container recreation.
RUN mkdir -p /home/mcp/.cache/camoufox && chown -R mcp:mcp /home/mcp/.cache

# Set environment variables for development
# NOTE: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is read by the camoufox client too —
# when it is set, `camoufox fetch` prints "Skipping browser download" and exits
# without downloading anything. Unset it for that one command:
#     docker compose exec -u mcp -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD= crawlforge-dev npx camoufox fetch
ENV NODE_ENV=development \
    HOME=/home/mcp \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    CACHE_DIR=/app/cache \
    LOG_LEVEL=debug \
    ENABLE_METRICS=true

# Switch to non-root user
USER mcp

# Default command for development
CMD ["npm", "run", "dev"]

# Production stage (last = default for Render/Docker)
FROM browser-base AS production

# Init system
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=mcp:mcp /app/node_modules ./node_modules
COPY --from=builder --chown=mcp:mcp /app/package*.json ./
COPY --from=builder --chown=mcp:mcp /app/server.js ./
COPY --from=builder --chown=mcp:mcp /app/src ./src
# The stealth benchmark harness (188 KB, including its ci-baseline.json under
# scripts/lib/stealth-bench/). It is here because the ONLY place its headline
# measurement can be taken is a box with the production exit IP: the whole
# question is whether a datacenter address passes walls a residential one does,
# and that cannot be inferred from a dev machine. Without this line the review's
# own instruction — `node scripts/stealth-bench.mjs` in the Render shell — fails
# with MODULE_NOT_FOUND, which is exactly what happened on 2026-09-22.
COPY --from=builder --chown=mcp:mcp /app/scripts ./scripts

# ─── Camoufox browser ────────────────────────────────────────────────────────
# Adds roughly 1.3 GB to the image (the Linux release zip alone is ~625 MiB,
# plus the ~66 MB MaxMind GeoLite2 city database the fetch pulls for `geoip`).
# Build with --build-arg INSTALL_CAMOUFOX=false for a slim image; `engine:
# "camoufox"` then fails at runtime and engine 'auto' falls back to Chromium.
#
# Two traps, both of which fail SILENTLY:
#  1. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD makes `camoufox fetch` a no-op. It is set
#     in the ENV block below, and `env -u` here keeps the two independent of
#     instruction order.
#  2. The extracted files do not carry the execute bit, so the launcher has to
#     be chmod'ed or Firefox never starts.
#
# NOT REPRODUCIBLE, and a known fingerprint cost. `camoufox fetch` always takes
# the newest GitHub release the client supports (its range is release >= beta.19
# and < "1"), so two builds of the same commit can ship different browsers; it
# currently lands 152.0.4-beta.30. camoufox@0.1.19 then sets the UA's rv: token
# from the installed binary but leaves the Firefox/NN token as browserforge
# generated it, and its bundled browserforge data only knows up to ~150 — so on
# a 152 binary EVERY generated UA self-contradicts, e.g.
#   Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/135.0
# (measured in this image, 5/5 launches; on the older 135 binary the two tokens
# agreed 3/5). rv: disagreeing with Firefox/ is a one-line detection. The fix is
# a current CLIENT, not a pinned binary — see the Phase 2 report on camoufox-js.
ARG INSTALL_CAMOUFOX=true
RUN if [ "$INSTALL_CAMOUFOX" = "true" ]; then \
        env -u PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD HOME=/home/mcp \
            ./node_modules/.bin/camoufox fetch && \
        chmod -R 755 /home/mcp/.cache/camoufox && \
        chown -R mcp:mcp /home/mcp/.cache; \
    else \
        echo "Skipping Camoufox download (INSTALL_CAMOUFOX=$INSTALL_CAMOUFOX)"; \
    fi

# Create necessary directories
RUN mkdir -p /app/cache /app/logs /app/snapshots /app/jobs /app/webhooks && \
    chown -R mcp:mcp /app/cache /app/logs /app/snapshots /app/jobs /app/webhooks

# Set environment variables
# HOME is explicit because camoufox resolves its browser through os.homedir().
ENV NODE_ENV=production \
    HOME=/home/mcp \
    NODE_OPTIONS="--max-old-space-size=512" \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    CACHE_DIR=/app/cache \
    LOG_LEVEL=info \
    ENABLE_METRICS=true

# Default PORT — overridable at runtime. Render injects PORT=10000 by default;
# other PaaS (Fly, Railway, etc.) inject their own. The server reads $PORT.
ENV PORT=10000

# Memory: a Camoufox browser costs measurably more than a Chromium one —
# 667 MB vs 253 MB RSS, 946 ms vs 148 ms to launch and open a first page
# (measured 2026-09-21). Since engine 'auto' prefers Camoufox, size the
# container for ~700 MB of browser per concurrent stealth session on top of the
# Node heap above; 1 GB total is no longer enough. See docker-compose.yml.

# Health check — actually probes the running HTTP server's /health endpoint.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT||10000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Switch to non-root user
USER mcp

# Expose port — matches the default $PORT above.
EXPOSE 10000

# Use tini as init system
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command (HTTP mode for remote deployment)
CMD ["node", "server.js", "--http"]
