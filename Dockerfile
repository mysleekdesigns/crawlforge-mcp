# Multi-stage Dockerfile for CrawlForge MCP Server
# Optimized for security, performance, and minimal image size

# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev

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

# Development stage
FROM node:20-alpine AS development

# Install development dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    git \
    curl \
    bash

# Create non-root user
RUN addgroup -g 1001 -S mcp && \
    adduser -S mcp -u 1001 -G mcp

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

# Set environment variables for development
ENV NODE_ENV=development \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CACHE_DIR=/app/cache \
    LOG_LEVEL=debug \
    ENABLE_METRICS=true

# Switch to non-root user
USER mcp

# Default command for development
CMD ["npm", "run", "dev"]

# Production stage (last = default for Render/Docker)
FROM node:20-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    dumb-init \
    tini

# Create non-root user
RUN addgroup -g 1001 -S mcp && \
    adduser -S mcp -u 1001 -G mcp

# Set working directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=mcp:mcp /app/node_modules ./node_modules
COPY --from=builder --chown=mcp:mcp /app/package*.json ./
COPY --from=builder --chown=mcp:mcp /app/server.js ./
COPY --from=builder --chown=mcp:mcp /app/src ./src

# Create necessary directories
RUN mkdir -p /app/cache /app/logs /app/snapshots /app/jobs /app/webhooks && \
    chown -R mcp:mcp /app/cache /app/logs /app/snapshots /app/jobs /app/webhooks

# Set environment variables
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CACHE_DIR=/app/cache \
    LOG_LEVEL=info \
    ENABLE_METRICS=true

# Default PORT — overridable at runtime. Render injects PORT=10000 by default;
# other PaaS (Fly, Railway, etc.) inject their own. The server reads $PORT.
ENV PORT=10000

# Health check — actually probes the running HTTP server's /health endpoint.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT||10000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Switch to non-root user
USER mcp

# Expose port — matches the default $PORT above.
EXPOSE 10000

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Default command (HTTP mode for remote deployment)
CMD ["node", "server.js", "--http"]
