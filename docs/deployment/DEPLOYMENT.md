# GridLLM Deployment Guide

GridLLM supports flexible deployment architectures: fully containerized, hybrid container/bare-metal, or native installations.

---

## Recommended: Multi-Host Docker Deployment

Production deployments typically distribute components across multiple machines for scalability and resource optimization.

### Setup Steps

1. **Infrastructure Node** (Redis + Ollama):

   ```sh
   # Create network and start infrastructure services
   docker network create gridllm-net
   docker run -d --name gridllm-redis --network gridllm-net --restart unless-stopped -p 6379:6379 redis:7-alpine
   docker run -d --name gridllm-ollama --network gridllm-net --restart unless-stopped -p 11434:11434 ollama/ollama:latest
   ```

2. **Server Node** (GridLLM coordination server):

   ```sh
   docker run -d --name gridllm-server --restart unless-stopped -p 4000:4000 \
     --env-file .env \
     campinator/gridllm-server:latest
   ```

3. **Worker Nodes** (GridLLM clients):
   ```sh
   docker run -d --name gridllm-worker --restart unless-stopped \
     --env-file .env \
     campinator/gridllm-client:latest
   ```

---

## Single-Host Development Deployment

For development or testing, all services can run on a single machine with Docker networking:

```sh
docker network create gridllm-net

# Start all services on the same network
docker run -d --name gridllm-redis --network gridllm-net --restart unless-stopped -p 6379:6379 redis:7-alpine
docker run -d --name gridllm-ollama --network gridllm-net --restart unless-stopped -p 11434:11434 ollama/ollama:latest

# Server can reference services by container name
docker run -d --name gridllm-server --network gridllm-net --restart unless-stopped -p 4000:4000 \
  -e REDIS_HOST=gridllm-redis \
  campinator/gridllm-server:latest

# Workers can reference all services by container name
docker run -d --name gridllm-worker-01 --network gridllm-net --restart unless-stopped \
  -e SERVER_HOST=gridllm-server \
  -e SERVER_REDIS_HOST=gridllm-redis \
  -e OLLAMA_HOST=gridllm-ollama \
  -e WORKER_ID=worker-01 \
  campinator/gridllm-client:latest
```

---

## Hybrid Deployments

### Connecting to Host Services

Connect containerized GridLLM to services running on the Docker host:

```env
# For Docker Desktop (Windows/macOS)
REDIS_HOST=host.docker.internal
OLLAMA_HOST=host.docker.internal

# For Linux, add to docker run:
# --add-host=host.docker.internal:host-gateway
```

### Mixed Container/Bare-Metal

Example configuration for mixed deployment scenarios:

```env
# Worker connecting to remote infrastructure
REDIS_HOST=redis.internal.company.com
OLLAMA_HOST=gpu-cluster-01.internal.company.com
SERVER_HOST=gridllm-server.internal.company.com
```

---

## Native Installation

Install and run without Docker using npm scripts:

```sh
# Install and build
npm run install:all
npm run build:all

# Start services
npm run start:server  # On server machine
npm run start:client  # On each worker machine
```

Configure via `.env` files in `server/` and `client/` directories.

---

## Environment Variables

The following are the most commonly configured variables for deployment. See `.env.example` files in the `server/` and `client/` directories for complete configuration options.

**Server:**

- `REDIS_HOST`: Redis hostname/IP
- `REDIS_PORT`: Redis port (default: 6379)
- `REDIS_PASSWORD`: Optional Redis auth

**Worker:**

- `SERVER_HOST`: GridLLM server hostname/IP
- `SERVER_PORT`: Server port (default: 4000)
- `SERVER_REDIS_HOST`: Redis hostname for worker coordination
- `OLLAMA_HOST`: Ollama hostname/IP
- `OLLAMA_PORT`: Ollama port (default: 11434)
- `WORKER_ID`: Unique worker identifier

---

## Troubleshooting

Ensure Redis, GridLLM server, and Ollama instances are network-accessible from worker nodes.

---

## Production Deployment Examples

GridLLM provides Docker Compose configurations for production deployments:

**Docker Images:**

- Release builds: `campinator/gridllm-server:latest`, `campinator/gridllm-client:latest`
- Nightly builds: `campinator/gridllm-server:nightly`, `campinator/gridllm-client:nightly`

**Deployment Commands:**

```sh
# Complete stack (single machine)
npm run compose:up

# Server and Redis only
npm run bundle

# Individual service management
docker compose -f docs/deployment/docker-compose.server.yml up -d
docker compose -f docs/deployment/docker-compose.client.yml up -d
docker compose -f docs/deployment/docker-compose.dependencies.yml up -d
```

**Multi-Machine Deployment Pattern:**

- **Infrastructure Node**: Redis + Ollama (`docker-compose.dependencies.yml`)
- **Server Node**: GridLLM coordination server (`docker-compose.server.yml`)
- **Worker Nodes**: GridLLM clients (`docker-compose.client.yml`)

Configure network connectivity between nodes via environment variables in each compose file.

For complete configuration options and API documentation, see the [README](../../README.md) and `.env.example` files.
