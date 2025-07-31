# GridLLM - Distributed AI Inference System

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3%2B-blue.svg)](https://www.typescriptlang.org/)

GridLLM is a **distributed AI inference system** that enables horizontal scaling of large language model (LLM) processing across multiple workers. It provides a centralized server that coordinates AI inference requests across a network of worker nodes, offering **Ollama API compatibility** and **intelligent load balancing**.

## Architecture Overview

GridLLM consists of three main components:

### 1. **Central Server** (`/server`)

-   **Job Scheduling**: Intelligently distributes inference requests across available workers
-   **Worker Registry**: Tracks worker capabilities, status, and performance metrics
-   **Load Balancing**: Routes requests to optimal workers based on model availability and load
-   **API Gateway**: Provides both native and Ollama-compatible API endpoints
-   **Health Monitoring**: Continuous health checks and worker status management

### 2. **Worker Clients** (`/client`)

-   **Ollama Integration**: Connects to local Ollama instances for model inference
-   **Capability Detection**: Automatically discovers available models and system resources
-   **Job Processing**: Handles inference requests from the central server
-   **Performance Tiering**: Self-classifies into high/medium/low performance tiers
-   **Auto-Registration**: Automatically registers with the central server

## Key Features

### **Distributed Architecture**

-   **Horizontal Scaling**: Add more workers to increase capacity
-   **Fault Tolerance**: Automatic failover when workers become unavailable
-   **Load Balancing**: Intelligent request distribution based on worker capabilities
-   **Real-time Monitoring**: Live tracking of worker status and job queues

### **Ollama API Compatibility**

-   **Drop-in Replacement**: Compatible with existing Ollama clients
-   **Complete API Coverage**: All Ollama endpoints supported (`/ollama/*`)
-   **Streaming Support**: Real-time token streaming for chat applications
-   **Model Management**: Distributed model availability across workers
-   **Thinking Models**: Support for `think` parameter to get reasoning from thinking models

### **Advanced Job Scheduling**

-   **Priority Queues**: High/medium/low priority job processing
-   **Timeout Management**: Configurable timeouts with automatic cleanup
-   **Worker Selection**: Optimal worker assignment based on:
    -   Model availability
    -   Current load
    -   Performance tier
    -   Resource utilization

### **Enterprise Ready**

-   **Redis Integration**: Robust job queuing with BullMQ
-   **Authentication**: JWT and API key support
-   **Rate Limiting**: Configurable request throttling
-   **Comprehensive Logging**: Structured logging with Winston
-   **Health Endpoints**: Detailed system status monitoring

## Installation

### Prerequisites

-   **Node.js 18+**
-   **Redis Server** (for job queuing)
-   **Ollama** (installed on worker nodes)
-   **npm** or **yarn**

### Quick Start

1. **Clone the repository**

```bash
git clone https://github.com/jwstanwick/GridLLM.git
cd GridLLM
```

2. **Install dependencies for both server and client**

```bash
make install
```

3. **Set up environment configuration**

```bash
# Copy example environment files
cp server/.env.example server/.env
cp client/.env.example client/.env

# Edit configuration files as needed
nano server/.env
nano client/.env
```

4. **Start Redis server** (if not already running)

```bash
redis-server
```

5. **Start the central server**

```bash
make run-server
```

6. **Start worker clients** (on each machine with Ollama)

```bash
make run-client
```

## Docker Deployment

GridLLM supports Docker deployment with configurable environment variables through a global `.env` file.

### Docker Configuration

1. **Copy the global environment template**

```bash
cp .env.example .env
```

2. **Configure Docker environment variables**

```env
# Network Configuration
DOCKER_NETWORK=bridge

# Server Configuration
SERVER_PORT=4000
SERVER_CONTAINER_NAME=gridllm-server-container
SERVER_IMAGE_NAME=gridllm-server

# Client Configuration
CLIENT_PORT=3000
CLIENT_CONTAINER_NAME=gridllm-client-container
CLIENT_IMAGE_NAME=gridllm-client
WORKER_ID=worker-docker-001

# Redis Configuration (adjust for your Redis setup)
REDIS_HOST=host.docker.internal
REDIS_PORT=6379

# Ollama Configuration (adjust for your Ollama setup)
OLLAMA_HOST=host.docker.internal
OLLAMA_PORT=11434
OLLAMA_PROTOCOL=http
```

### Docker Commands

All Docker commands use the environment variables from your `.env` file:

```bash
# Build Docker images
make docker-build          # Build both server and client images
make docker-build-server   # Build server image only
make docker-build-client   # Build client image only

# Run containers
make docker-run            # Start both containers
make docker-run-server     # Start server container only
make docker-run-client     # Start client container only

# Management
make docker-stop           # Stop all containers
make docker-clean          # Remove containers and images
make docker-logs           # View container logs
make docker-status         # Check container status
```

### Docker Network Setup

For production deployments, consider creating a custom Docker network:

```bash
# Create a custom network
docker network create gridllm-network

# Update .env file
DOCKER_NETWORK=gridllm-network

# Deploy Redis in the same network
docker run -d --name redis --network gridllm-network redis:alpine

# Update Redis host in .env
REDIS_HOST=redis
```

## Configuration

### Server Configuration (`server/.env`)

```env
# Server Settings
NODE_ENV=development
PORT=4000
SERVER_ID=gridllm-server-1

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Security
CORS_ORIGIN=*
API_KEY_ENABLED=false
JWT_SECRET=your-secret-key

# Job Processing
DEFAULT_JOB_TIMEOUT=300000
MAX_CONCURRENT_JOBS=100
WORKER_HEARTBEAT_INTERVAL=30000
```

### Worker Configuration (`client/.env`)

```env
# Worker Settings
NODE_ENV=development
PORT=3000
WORKER_ID=worker-1

# Server Connection
SERVER_HOST=localhost
SERVER_PORT=4000

# Ollama Configuration
OLLAMA_HOST=localhost
OLLAMA_PORT=11434

# Performance
MAX_CONCURRENT_TASKS=3
PERFORMANCE_TIER=auto
```

## 🛠️ Development Commands

GridLLM includes a comprehensive Makefile for development:

```bash
# Installation
make install          # Install all dependencies
make install-server   # Install server dependencies only
make install-client   # Install client dependencies only

# Development
make run-server       # Start server in development mode
make run-client       # Start client in development mode

# Building
make build-server     # Build server for production
make build-client     # Build client for production

# Utilities
make logs-server      # View server logs
make logs-client      # View client logs
make clean           # Clean build artifacts and logs
make test            # Run test suites
make format          # Format code with Prettier
make status          # Check system status

# Setup
make setup           # Complete development environment setup
```

## API Usage

### Native GridLLM API

#### Submit Inference Request

```bash
curl -X POST http://localhost:4000/inference \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "prompt": "Explain quantum computing",
    "priority": "high",
    "stream": false
  }'
```

#### Check Job Status

```bash
curl http://localhost:4000/inference/{job-id}/status
```

#### List Available Models

```bash
curl http://localhost:4000/inference/models
```

#### View Queue Statistics

```bash
curl http://localhost:4000/inference/queue
```

### Ollama-Compatible API

#### Generate Completion

```bash
curl -X POST http://localhost:4000/ollama/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "prompt": "What is the capital of France?",
    "stream": false
  }'
```

#### Generate Completion with Thinking (for thinking models)

```bash
curl -X POST http://localhost:4000/ollama/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3:14b",
    "prompt": "What is the capital of the US?",
    "think": true,
    "stream": false
  }'
```

Response with thinking:

```json
{
	"model": "qwen3:14b",
	"created_at": "2025-07-30T00:38:06.249971Z",
	"response": "The capital of the United States is **Washington, D.C.**",
	"thinking": "The user is asking for the capital of the United States...",
	"done": true,
	"done_reason": "stop"
}
```

#### Chat Completion

```bash
curl -X POST http://localhost:4000/ollama/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "stream": false
  }'
```

#### Chat Completion with Thinking

```bash
curl -X POST http://localhost:4000/ollama/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3:14b",
    "messages": [
      {"role": "user", "content": "Explain quantum computing"}
    ],
    "think": true,
    "stream": false
  }'
```

Response with thinking:

```json
{
	"model": "qwen3:14b",
	"created_at": "2025-07-30T00:38:06.249971Z",
	"message": {
		"role": "assistant",
		"content": "Quantum computing is a revolutionary approach...",
		"thinking": "The user wants me to explain quantum computing..."
	},
	"done": true
}
```

#### List Models

```bash
curl http://localhost:4000/ollama/api/tags
```

## Architecture Deep Dive

### Job Flow

1. **Request Reception**: Client submits inference request to server
2. **Validation**: Server validates request and checks model availability
3. **Worker Selection**: Intelligent worker selection based on:
    - Model availability
    - Current load
4. **Job Assignment**: Request is queued and assigned to optimal worker
5. **Processing**: Worker processes inference via local Ollama
6. **Response**: Result is returned through the server to client

### Worker Registration

1. **Capability Detection**: Worker scans local Ollama for available models
2. **Resource Assessment**: System resources are evaluated for performance tiering
3. **Server Registration**: Worker registers capabilities with central server
4. **Heartbeat**: Continuous health monitoring and status updates
