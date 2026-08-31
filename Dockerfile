# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install

# Copy source code
COPY . .

# Build the Next.js standalone output
RUN npm run build

# ---- Stage 2: Production ----
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
# PORT is set by the hosting platform (Render, Railway, etc.)
# Default to 3000 for local docker runs
ENV PORT="${PORT:-3000}"

# Run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Copy standalone output from builder
COPY --from=builder /app/.next/standalone ./
# Python 3 runtime for the analytics subprocess (Phase 5) —
# stdlib-only engine, no pip dependencies, no persistent service.
# If this layer is removed, the app still works: analytics
# degrade to an explicit UNAVAILABLE state (spec §27).
RUN apk add --no-cache python3

# Copy the Python analytics engine into the standalone output
COPY --from=builder /app/python-analytics ./python-analytics

# Set correct permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]