# GridLLM Development Scripts
.PHONY: help install install-server install-client run run-server run-client stop run-server-native run-client-native build-server build-client clean logs-server logs-client logs-server-docker logs-client-docker logs-server-native logs-client-native test docker-build docker-build-server docker-build-client docker-run docker-run-server docker-run-client docker-stop docker-clean docker-logs docker-status bundle bundle-with-client bundle-stop bundle-logs compose-up compose-down compose-build compose-logs compose-status compose-clean

# Load environment variables from .env file if it exists
ifneq (,$(wildcard ./.env))
    include .env
    export
endif

# Default values for environment variables (can be overridden by .env file)
NODE_ENV ?= development
DOCKER_NETWORK ?= bridge
SERVER_PORT ?= 4000
CLIENT_PORT ?= 3000
SERVER_CONTAINER_NAME ?= gridllm-server-container
CLIENT_CONTAINER_NAME ?= gridllm-client-container
SERVER_IMAGE_NAME ?= gridllm-server
CLIENT_IMAGE_NAME ?= gridllm-client
REDIS_HOST ?= host.docker.internal
REDIS_PORT ?= 6379
REDIS_PASSWORD ?= 
REDIS_DB ?= 0
REDIS_KEY_PREFIX ?= GridLLM:
OLLAMA_HOST ?= host.docker.internal
OLLAMA_PORT ?= 11434
OLLAMA_PROTOCOL ?= http
OLLAMA_TIMEOUT ?= 300000
OLLAMA_MAX_RETRIES ?= 3
WORKER_ID ?= worker-docker-001
WORKER_CONCURRENCY ?= 2
WORKER_MAX_CONCURRENT_JOBS ?= 1
WORKER_POLL_INTERVAL ?= 1000
WORKER_RESOURCE_CHECK_INTERVAL ?= 10000
MAX_CPU_USAGE ?= 80
MAX_MEMORY_USAGE ?= 85
MAX_GPU_MEMORY_USAGE ?= 90
MIN_AVAILABLE_MEMORY_MB ?= 1024
API_KEY ?= worker-api-key
LOG_LEVEL ?= info
HEALTH_CHECK_INTERVAL ?= 60000
TASK_TIMEOUT ?= 600000
TASK_RETRY_ATTEMPTS ?= 3
TASK_RETRY_DELAY ?= 5000
RATE_LIMIT_WINDOW ?= 60000
RATE_LIMIT_MAX_REQUESTS ?= 100
CORS_ORIGIN ?= *
JOB_TIMEOUT ?= 600000
WORKER_TIMEOUT ?= 300000
WORKER_HEARTBEAT_TIMEOUT ?= 60000
WORKER_CLEANUP_INTERVAL ?= 30000
MAX_CONCURRENT_JOBS_PER_WORKER ?= 1

# Default target
help:
	@echo "GridLLM Development Commands:"
	@echo ""
	@echo "  Setup Commands:"
	@echo "    setup           - Complete development environment setup"
	@echo "    install         - Install dependencies for both server and client"
	@echo "    install-server  - Install server dependencies only"
	@echo "    install-client  - Install client dependencies only"
	@echo ""
	@echo "  Development Commands (Docker-based):"
	@echo "    run             - Build and start both server and client in Docker"
	@echo "    run-server      - Build and start the central server in Docker"
	@echo "    run-client      - Build and start the worker client in Docker"
	@echo "    stop            - Stop running server and client containers"
	@echo ""
	@echo "  Native Development Commands:"
	@echo "    run-server-native - Start the central server in native development mode"
	@echo "    run-client-native - Start the worker client in native development mode"
	@echo ""
	@echo "  Build Commands:"
	@echo "    build-server    - Build server for production"
	@echo "    build-client    - Build client for production"
	@echo ""
	@echo "  Docker Commands (configured via .env file):"
	@echo "    docker-build         - Build both Docker images"
	@echo "    docker-build-server  - Build server Docker image"
	@echo "    docker-build-client  - Build client Docker image"
	@echo "    docker-run          - Run both containers"
	@echo "    docker-run-server   - Run server container"
	@echo "    docker-run-client   - Run client container"
	@echo "    docker-stop         - Stop all containers"
	@echo "    docker-clean        - Remove all containers and images"
	@echo "    docker-logs         - View logs from all containers"
	@echo "    docker-status       - Check status of all containers"
	@echo ""
	@echo "  Bundle Commands (Docker Compose with Redis):"
	@echo "    bundle              - Start server + Redis with Docker Compose"
	@echo "    bundle-with-client  - Start server + Redis + client with Docker Compose"
	@echo "    bundle-stop         - Stop all bundle services"
	@echo "    bundle-logs         - View bundle services logs"
	@echo ""
	@echo "  Utility Commands:"
	@echo "    status          - Check overall system status"
	@echo "    logs-server     - View server logs (Docker container)"
	@echo "    logs-client     - View client logs (Docker container)"
	@echo "    logs-server-docker - Follow server Docker container logs"
	@echo "    logs-client-docker - Follow client Docker container logs"
	@echo "    logs-server-native - View native server logs"
	@echo "    logs-client-native - View native client logs"
	@echo "    clean          - Clean build artifacts and logs"
	@echo "    test           - Run tests"
	@echo "    format         - Format code with Prettier"
	@echo ""
	@echo "  Configuration:"
	@echo "    Copy .env.example to .env and customize values"
	@echo "    Run 'make setup' for complete environment setup"
	@echo "    Use 'make run' to start the complete system with Docker"

# Installation commands
install: install-server install-client

install-server:
	@echo "Installing server dependencies..."
	cd server && npm install

install-client:
	@echo "Installing client dependencies..."
	cd client && npm install

# Development commands (Docker-based deployment)
run: docker-build
	@echo "Starting complete GridLLM system in Docker..."
	@echo "Building and starting both server and client..."
	@$(MAKE) run-server
	@$(MAKE) run-client
	@echo ""
	@echo "🎉 GridLLM system is running!"
	@echo "📊 Server: http://localhost:$(SERVER_PORT)/health"
	@echo "🔧 Client: http://localhost:$(CLIENT_PORT)/health"
	@echo "📋 Use 'make status' to check system status"

run-server: docker-build-server
	@echo "Starting GridLLM Server in Docker..."
	@echo "Server will be available at http://localhost:$(SERVER_PORT)"
	@docker stop $(SERVER_CONTAINER_NAME) 2>/dev/null || true
	@docker rm $(SERVER_CONTAINER_NAME) 2>/dev/null || true
	docker run -d -p $(SERVER_PORT):$(SERVER_PORT) --name $(SERVER_CONTAINER_NAME) \
		--network $(DOCKER_NETWORK) \
		-e NODE_ENV=$(NODE_ENV) \
		-e PORT=$(SERVER_PORT) \
		-e REDIS_HOST=$(REDIS_HOST) \
		-e REDIS_PORT=$(REDIS_PORT) \
		-e REDIS_PASSWORD=$(REDIS_PASSWORD) \
		-e REDIS_DB=$(REDIS_DB) \
		-e REDIS_KEY_PREFIX=$(REDIS_KEY_PREFIX) \
		-e WORKER_TIMEOUT=$(WORKER_TIMEOUT) \
		-e WORKER_HEARTBEAT_TIMEOUT=$(WORKER_HEARTBEAT_TIMEOUT) \
		-e WORKER_CLEANUP_INTERVAL=$(WORKER_CLEANUP_INTERVAL) \
		-e JOB_TIMEOUT=$(JOB_TIMEOUT) \
		-e TASK_RETRY_ATTEMPTS=$(TASK_RETRY_ATTEMPTS) \
		-e TASK_RETRY_DELAY=$(TASK_RETRY_DELAY) \
		-e MAX_CONCURRENT_JOBS_PER_WORKER=$(MAX_CONCURRENT_JOBS_PER_WORKER) \
		-e LOG_LEVEL=$(LOG_LEVEL) \
		-e HEALTH_CHECK_INTERVAL=$(HEALTH_CHECK_INTERVAL) \
		-e RATE_LIMIT_WINDOW=$(RATE_LIMIT_WINDOW) \
		-e RATE_LIMIT_MAX_REQUESTS=$(RATE_LIMIT_MAX_REQUESTS) \
		-e CORS_ORIGIN=$(CORS_ORIGIN) \
		$(SERVER_IMAGE_NAME)
	@echo "✅ Server container started on port $(SERVER_PORT)"
	@echo "🔍 Use 'make logs-server-docker' to view logs"

run-client: docker-build-client
	@echo "Starting GridLLM Worker Client in Docker..."
	@echo "Worker health check at http://localhost:$(CLIENT_PORT)"
	@docker stop $(CLIENT_CONTAINER_NAME) 2>/dev/null || true
	@docker rm $(CLIENT_CONTAINER_NAME) 2>/dev/null || true
	docker run -d -p $(CLIENT_PORT):$(CLIENT_PORT) --name $(CLIENT_CONTAINER_NAME) \
		--network $(DOCKER_NETWORK) \
		-e NODE_ENV=$(NODE_ENV) \
		-e PORT=$(CLIENT_PORT) \
		-e WORKER_ID=$(WORKER_ID) \
		-e SERVER_HOST=$(REDIS_HOST) \
		-e SERVER_PORT=$(SERVER_PORT) \
		-e SERVER_REDIS_HOST=$(REDIS_HOST) \
		-e SERVER_REDIS_PORT=$(REDIS_PORT) \
		-e SERVER_REDIS_PASSWORD=$(REDIS_PASSWORD) \
		-e REDIS_DB=$(REDIS_DB) \
		-e REDIS_KEY_PREFIX=$(REDIS_KEY_PREFIX) \
		-e OLLAMA_HOST=$(OLLAMA_HOST) \
		-e OLLAMA_PORT=$(OLLAMA_PORT) \
		-e OLLAMA_PROTOCOL=$(OLLAMA_PROTOCOL) \
		-e OLLAMA_TIMEOUT=$(OLLAMA_TIMEOUT) \
		-e OLLAMA_MAX_RETRIES=$(OLLAMA_MAX_RETRIES) \
		-e WORKER_CONCURRENCY=$(WORKER_CONCURRENCY) \
		-e WORKER_MAX_CONCURRENT_JOBS=$(WORKER_MAX_CONCURRENT_JOBS) \
		-e WORKER_POLL_INTERVAL=$(WORKER_POLL_INTERVAL) \
		-e WORKER_RESOURCE_CHECK_INTERVAL=$(WORKER_RESOURCE_CHECK_INTERVAL) \
		-e MAX_CPU_USAGE=$(MAX_CPU_USAGE) \
		-e MAX_MEMORY_USAGE=$(MAX_MEMORY_USAGE) \
		-e MAX_GPU_MEMORY_USAGE=$(MAX_GPU_MEMORY_USAGE) \
		-e MIN_AVAILABLE_MEMORY_MB=$(MIN_AVAILABLE_MEMORY_MB) \
		-e API_KEY=$(API_KEY) \
		-e LOG_LEVEL=$(LOG_LEVEL) \
		-e HEALTH_CHECK_INTERVAL=$(HEALTH_CHECK_INTERVAL) \
		-e TASK_TIMEOUT=$(TASK_TIMEOUT) \
		-e TASK_RETRY_ATTEMPTS=$(TASK_RETRY_ATTEMPTS) \
		-e TASK_RETRY_DELAY=$(TASK_RETRY_DELAY) \
		-e RATE_LIMIT_WINDOW=$(RATE_LIMIT_WINDOW) \
		-e RATE_LIMIT_MAX_REQUESTS=$(RATE_LIMIT_MAX_REQUESTS) \
		-e CORS_ORIGIN=$(CORS_ORIGIN) \
		$(CLIENT_IMAGE_NAME)
	@echo "✅ Client container started on port $(CLIENT_PORT)"
	@echo "🔍 Use 'make logs-client-docker' to view logs"

# Native development commands (for local development without Docker)
run-server-native:
	@echo "Starting GridLLM Server in native mode..."
	@echo "Server will be available at http://localhost:$(SERVER_PORT)"
	cd server && npm run dev

run-client-native:
	@echo "Starting GridLLM Worker Client in native mode..."
	@echo "Worker health check at http://localhost:$(CLIENT_PORT)"
	cd client && npm run dev

# Container management
stop:
	@echo "Stopping GridLLM containers..."
	@docker stop $(SERVER_CONTAINER_NAME) $(CLIENT_CONTAINER_NAME) 2>/dev/null || true
	@echo "✅ All containers stopped"

# Build commands
build-server:
	@echo "Building server for production..."
	cd server && npm run build

build-client:
	@echo "Building client for production..."
	cd client && npm run build

# Docker commands
docker-build: docker-build-server docker-build-client

docker-build-server:
	@echo "Building server Docker image..."
	cd server && docker build -t $(SERVER_IMAGE_NAME) .
	@echo "✅ Server Docker image built successfully!"

docker-build-client:
	@echo "Building client Docker image..."
	cd client && docker build -t $(CLIENT_IMAGE_NAME) .
	@echo "✅ Client Docker image built successfully!"

docker-run: docker-run-server docker-run-client

docker-run-server:
	@echo "Starting server container..."
	@docker stop $(SERVER_CONTAINER_NAME) 2>/dev/null || true
	@docker rm $(SERVER_CONTAINER_NAME) 2>/dev/null || true
	docker run -d -p $(SERVER_PORT):$(SERVER_PORT) --name $(SERVER_CONTAINER_NAME) \
		--network $(DOCKER_NETWORK) \
		-e NODE_ENV=$(NODE_ENV) \
		-e PORT=$(SERVER_PORT) \
		-e REDIS_HOST=$(REDIS_HOST) \
		-e REDIS_PORT=$(REDIS_PORT) \
		-e REDIS_PASSWORD=$(REDIS_PASSWORD) \
		-e REDIS_DB=$(REDIS_DB) \
		-e REDIS_KEY_PREFIX=$(REDIS_KEY_PREFIX) \
		-e WORKER_TIMEOUT=$(WORKER_TIMEOUT) \
		-e WORKER_HEARTBEAT_TIMEOUT=$(WORKER_HEARTBEAT_TIMEOUT) \
		-e WORKER_CLEANUP_INTERVAL=$(WORKER_CLEANUP_INTERVAL) \
		-e JOB_TIMEOUT=$(JOB_TIMEOUT) \
		-e TASK_RETRY_ATTEMPTS=$(TASK_RETRY_ATTEMPTS) \
		-e TASK_RETRY_DELAY=$(TASK_RETRY_DELAY) \
		-e MAX_CONCURRENT_JOBS_PER_WORKER=$(MAX_CONCURRENT_JOBS_PER_WORKER) \
		-e LOG_LEVEL=$(LOG_LEVEL) \
		-e HEALTH_CHECK_INTERVAL=$(HEALTH_CHECK_INTERVAL) \
		-e RATE_LIMIT_WINDOW=$(RATE_LIMIT_WINDOW) \
		-e RATE_LIMIT_MAX_REQUESTS=$(RATE_LIMIT_MAX_REQUESTS) \
		-e CORS_ORIGIN=$(CORS_ORIGIN) \
		$(SERVER_IMAGE_NAME)
	@echo "✅ Server container started on port $(SERVER_PORT)"

docker-run-client:
	@echo "Starting client container..."
	@docker stop $(CLIENT_CONTAINER_NAME) 2>/dev/null || true
	@docker rm $(CLIENT_CONTAINER_NAME) 2>/dev/null || true
	docker run -d -p $(CLIENT_PORT):$(CLIENT_PORT) --name $(CLIENT_CONTAINER_NAME) \
		--network $(DOCKER_NETWORK) \
		-e NODE_ENV=$(NODE_ENV) \
		-e PORT=$(CLIENT_PORT) \
		-e WORKER_ID=$(WORKER_ID) \
		-e SERVER_HOST=$(REDIS_HOST) \
		-e SERVER_PORT=$(SERVER_PORT) \
		-e SERVER_REDIS_HOST=$(REDIS_HOST) \
		-e SERVER_REDIS_PORT=$(REDIS_PORT) \
		-e SERVER_REDIS_PASSWORD=$(REDIS_PASSWORD) \
		-e REDIS_DB=$(REDIS_DB) \
		-e REDIS_KEY_PREFIX=$(REDIS_KEY_PREFIX) \
		-e OLLAMA_HOST=$(OLLAMA_HOST) \
		-e OLLAMA_PORT=$(OLLAMA_PORT) \
		-e OLLAMA_PROTOCOL=$(OLLAMA_PROTOCOL) \
		-e OLLAMA_TIMEOUT=$(OLLAMA_TIMEOUT) \
		-e OLLAMA_MAX_RETRIES=$(OLLAMA_MAX_RETRIES) \
		-e WORKER_CONCURRENCY=$(WORKER_CONCURRENCY) \
		-e WORKER_MAX_CONCURRENT_JOBS=$(WORKER_MAX_CONCURRENT_JOBS) \
		-e WORKER_POLL_INTERVAL=$(WORKER_POLL_INTERVAL) \
		-e WORKER_RESOURCE_CHECK_INTERVAL=$(WORKER_RESOURCE_CHECK_INTERVAL) \
		-e MAX_CPU_USAGE=$(MAX_CPU_USAGE) \
		-e MAX_MEMORY_USAGE=$(MAX_MEMORY_USAGE) \
		-e MAX_GPU_MEMORY_USAGE=$(MAX_GPU_MEMORY_USAGE) \
		-e MIN_AVAILABLE_MEMORY_MB=$(MIN_AVAILABLE_MEMORY_MB) \
		-e API_KEY=$(API_KEY) \
		-e LOG_LEVEL=$(LOG_LEVEL) \
		-e HEALTH_CHECK_INTERVAL=$(HEALTH_CHECK_INTERVAL) \
		-e TASK_TIMEOUT=$(TASK_TIMEOUT) \
		-e TASK_RETRY_ATTEMPTS=$(TASK_RETRY_ATTEMPTS) \
		-e TASK_RETRY_DELAY=$(TASK_RETRY_DELAY) \
		-e RATE_LIMIT_WINDOW=$(RATE_LIMIT_WINDOW) \
		-e RATE_LIMIT_MAX_REQUESTS=$(RATE_LIMIT_MAX_REQUESTS) \
		-e CORS_ORIGIN=$(CORS_ORIGIN) \
		$(CLIENT_IMAGE_NAME)
	@echo "✅ Client container started on port $(CLIENT_PORT)"

docker-stop:
	@echo "Stopping all containers..."
	@docker stop $(SERVER_CONTAINER_NAME) $(CLIENT_CONTAINER_NAME) 2>/dev/null || true
	@echo "✅ All containers stopped"

docker-clean: docker-stop
	@echo "Cleaning up containers and images..."
	@docker rm $(SERVER_CONTAINER_NAME) $(CLIENT_CONTAINER_NAME) 2>/dev/null || true
	@docker rmi $(SERVER_IMAGE_NAME) $(CLIENT_IMAGE_NAME) 2>/dev/null || true
	@echo "✅ Cleanup complete"

docker-logs:
	@echo "=== Server Container Logs ==="
	@docker logs $(SERVER_CONTAINER_NAME) 2>/dev/null || echo "Server container not running"
	@echo ""
	@echo "=== Client Container Logs ==="
	@docker logs $(CLIENT_CONTAINER_NAME) 2>/dev/null || echo "Client container not running"

docker-status:
	@echo "=== Docker Container Status ==="
	@echo ""
	@echo "Running Containers:"
	@docker ps --filter "name=gridllm" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "No containers running"
	@echo ""
	@echo "Available Images:"
	@docker images --filter "reference=gridllm-*" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" 2>/dev/null || echo "No images found"
	@echo ""
	@echo "Health Checks:"
	@curl -s http://localhost:$(SERVER_PORT)/health 2>/dev/null | jq '.' || echo "Server not responding on port $(SERVER_PORT)"
	@curl -s http://localhost:$(CLIENT_PORT)/health 2>/dev/null | jq '.' || echo "Client not responding on port $(CLIENT_PORT)"

# Utility commands
logs-server:
	@echo "Server Docker container logs:"
	@docker logs -f $(SERVER_CONTAINER_NAME) 2>/dev/null || echo "Server container not running. Use 'make run-server' to start."

logs-client:
	@echo "Client Docker container logs:"
	@docker logs -f $(CLIENT_CONTAINER_NAME) 2>/dev/null || echo "Client container not running. Use 'make run-client' to start."

logs-server-docker:
	@echo "Following server Docker container logs (Ctrl+C to exit):"
	@docker logs -f $(SERVER_CONTAINER_NAME) 2>/dev/null || echo "Server container not running. Use 'make run-server' to start."

logs-client-docker:
	@echo "Following client Docker container logs (Ctrl+C to exit):"
	@docker logs -f $(CLIENT_CONTAINER_NAME) 2>/dev/null || echo "Client container not running. Use 'make run-client' to start."

logs-server-native:
	@echo "Native server logs:"
	@tail -f server/logs/GridLLM-server.log 2>/dev/null || echo "No native server logs found. Start with 'make run-server-native' first."

logs-client-native:
	@echo "Native client logs:"
	@tail -f client/logs/GridLLM-client.log 2>/dev/null || echo "No native client logs found. Start with 'make run-client-native' first."

clean:
	@echo "Cleaning build artifacts and logs..."
	rm -rf server/dist client/dist dist
	rm -rf server/logs/* logs/*
	@echo "Clean complete!"

test:
	@echo "Running tests..."
	npm test
	cd server && npm test

# Quick status check
status:
	@echo "=== GridLLM Network Status ==="
	@echo ""
	@echo "Server Status:"
	@curl -s http://localhost:$(SERVER_PORT)/health 2>/dev/null | jq '.' || echo "Server not responding"
	@echo ""
	@echo "Client Status:"
	@curl -s http://localhost:$(CLIENT_PORT)/health 2>/dev/null | jq '.' || echo "Client not responding"
	@echo ""
	@echo "Available Models:"
	@curl -s http://localhost:$(SERVER_PORT)/inference/models 2>/dev/null | jq '.models[] | .name' || echo "Could not fetch models"

# Development environment setup
setup: install
	@echo "Setting up development environment..."
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created global .env file - please configure it"; fi
	@if [ ! -f server/.env ]; then cp server/.env.example server/.env && echo "Created server/.env file - please configure it"; fi
	@if [ ! -f client/.env ]; then cp client/.env.example client/.env && echo "Created client/.env file - please configure it"; fi
	@mkdir -p logs server/logs client/logs
	@echo ""
	@echo "🎉 Setup complete!"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Configure .env files with your settings"
	@echo "  2. Run 'make run' to start the complete system with Docker"
	@echo "  3. Or run 'make run-server' and 'make run-client' separately"
	@echo ""
	@echo "For native development (without Docker):"
	@echo "  - Use 'make run-server-native' and 'make run-client-native'"

format:
	@echo "Formatting code with Prettier..."
	npx prettier --write "**/*.ts" "**/*.js" "**/*.json" "**/*.md"
	@echo "Code formatted successfully!"

# Bundle Commands (Docker Compose with Redis)
bundle:
	@echo "Starting GridLLM bundle (Server + Redis)..."
	@echo "🔨 Building and starting server and Redis with Docker Compose"
	docker compose up -d redis server
	@echo "✅ Bundle started successfully!"
	@echo "📊 Server: http://localhost:$(SERVER_PORT)/health"
	@echo "🔍 Redis: localhost:$(REDIS_PORT)"
	@echo "📋 Use 'make bundle-logs' to view logs"

bundle-with-client:
	@echo "Starting GridLLM full bundle (Server + Redis + Client)..."
	@echo "🔨 Building and starting all services with Docker Compose"
	docker compose up -d
	@echo "✅ Full bundle started successfully!"
	@echo "📊 Server: http://localhost:$(SERVER_PORT)/health"
	@echo "🔧 Client: http://localhost:$(CLIENT_PORT)/health"
	@echo "🔍 Redis: localhost:$(REDIS_PORT)"
	@echo "📋 Use 'make bundle-logs' to view logs"

bundle-stop:
	@echo "Stopping bundle services..."
	docker compose down
	@echo "✅ Bundle services stopped"

bundle-logs:
	@echo "Viewing bundle services logs (Ctrl+C to exit)..."
	docker compose logs -f

# Docker Compose Commands
compose-up:
	@echo "Starting all services with Docker Compose..."
	docker compose up -d
	@echo "✅ All services started"

compose-down:
	@echo "Stopping all Docker Compose services..."
	docker compose down
	@echo "✅ All services stopped"

compose-build:
	@echo "Building Docker Compose services..."
	docker compose build
	@echo "✅ Services built successfully"

compose-logs:
	@echo "Viewing Docker Compose logs (Ctrl+C to exit)..."
	docker compose logs -f

compose-status:
	@echo "=== Docker Compose Status ==="
	docker compose ps
	@echo ""
	@echo "=== Service Health Checks ==="
	@curl -s http://localhost:$(SERVER_PORT)/health 2>/dev/null | jq '.' || echo "Server not responding"
	@curl -s http://localhost:$(CLIENT_PORT)/health 2>/dev/null | jq '.' || echo "Client not responding"

compose-clean:
	@echo "Cleaning up Docker Compose services and volumes..."
	docker compose down -v --remove-orphans
	docker compose rm -f
	@echo "✅ Cleanup complete"