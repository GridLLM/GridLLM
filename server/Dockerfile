# ---- Build Stage ----
FROM node:24.4-alpine AS build

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files and install all dependencies
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci

# Copy source and build
COPY src/ ./src/
RUN npm run build

# ---- Production Stage ----
FROM node:24.4-alpine

WORKDIR /app

# Only copy production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built app and config
COPY --from=build /app/dist ./dist
COPY --from=build /app/tsconfig.json ./tsconfig.json

# Create logs directory
RUN mkdir -p logs

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S gridllm -u 1001 -G nodejs && \
    chown -R gridllm:nodejs /app

USER gridllm

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["npm", "start"]
