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

# Production stage
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
RUN mkdir -p /app/cache /app/logs && \
    chown -R mcp:mcp /app/cache /app/logs

# Set environment variables
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CACHE_DIR=/app/cache \
    LOG_LEVEL=info \
    ENABLE_METRICS=true

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# Switch to non-root user
USER mcp

# Expose port (if needed for HTTP mode)
EXPOSE 3000

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Default command
CMD ["node", "server.js"]

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

# Testing stage
FROM development AS testing

# Copy test files
COPY --chown=mcp:mcp tests/ ./tests/

# Set environment for testing
ENV NODE_ENV=test \
    CACHE_ENABLE_DISK=false

# Run tests
RUN npm test

# Security scanning stage
FROM aquasec/trivy:latest AS security-scan

# Copy the production image for scanning
COPY --from=production /app /scan-target

# Run security scan
RUN trivy fs --exit-code 1 --severity HIGH,CRITICAL /scan-target