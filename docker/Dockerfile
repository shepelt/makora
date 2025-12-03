# Multi-stage build for Makora Meteor Application

# Stage 1: Build the Meteor application
FROM node:20-slim AS builder

# Install dependencies and Meteor
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/* && \
    curl https://install.meteor.com/ | sh

# Set working directory
WORKDIR /app

# Clone and build muya fork (increase Node heap for vite build)
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN git clone --depth 1 https://github.com/shepelt/muya.git /muya && \
    cd /muya && npm install --legacy-peer-deps && \
    cd packages/core && npm install && npm run build && npm pack && \
    mv *.tgz /muya-core.tgz

# Copy package files (use docker-specific package.json)
COPY docker/package.docker.json ./package.json

# Install dependencies (including local muya build)
RUN npm install /muya-core.tgz && npm install

# Copy application source
COPY . .

# Restore docker-specific package.json (COPY . . overwrote it)
COPY docker/package.docker.json ./package.json

# Build Meteor application (allow running as root in Docker)
ENV METEOR_ALLOW_SUPERUSER=1
RUN meteor build --directory /build --server-only

# Stage 2: Production runtime
FROM node:20-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    bash \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy built application from builder
COPY --from=builder /build/bundle /app

# Copy entrypoint script
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Install production dependencies
WORKDIR /app/programs/server
RUN npm install --omit=dev

# Switch back to app directory
WORKDIR /app

# Create non-root user (Debian syntax)
RUN groupadd --system meteor && useradd --system --gid meteor --home-dir /app meteor && \
    chown -R meteor:meteor /app

# Switch to non-root user
USER meteor

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Start the application using entrypoint that loads settings
CMD ["/app/entrypoint.sh"]
