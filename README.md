# GridLLM - Distributed AI Inference System

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3%2B-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://docker.com/)
[![Redis](https://img.shields.io/badge/Redis-7.0%2B-red.svg)](https://redis.io/)
[![Ollama](https://img.shields.io/badge/Ollama-Compatible-orange.svg)](https://ollama.ai/)

GridLLM is a **production-ready distributed AI inference system** that enables horizontal scaling of large language model (LLM) processing across multiple workers. It provides a centralized server that coordinates AI inference requests across a network of worker nodes, offering **complete Ollama API compatibility** and **intelligent load balancing** with enterprise-grade features.

For support, please join our official [discord server](https://discord.com/channels/1400687383342743552/1400687384089198724)

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/GridLLM/GridLLM.git
cd GridLLM

# Start the complete system (Server + Redis + Client)
npm run bundle:full

# Or start just server + Redis (add clients separately)
npm run bundle

# Check system status
npm run status
```

### Manual Setup

```bash
# Install dependencies
npm run install:all

# Configure environment variables
cp .env.example .env
cp server/.env.example server/.env
cp client/.env.example client/.env

# Start Redis (required)
redis-server

# Start server
npm run dev:server

# Start worker client(s)
npm run dev:client
```

## Switching from Ollama to GridLLM

GridLLM provides **100% API compatibility** with Ollama. To switch your existing applications from Ollama to GridLLM's distributed system, simply change your base URL:

**Before (Ollama):**
```
http://localhost:11434
```

**After (GridLLM):**
```
http://localhost:4000/ollama
```

That's it! All your existing Ollama API calls will work unchanged:

```bash
# Your existing Ollama calls work as-is
curl -X POST http://localhost:4000/ollama/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "prompt": "Hello world",
    "stream": false
  }'

curl -X POST http://localhost:4000/ollama/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "messages": [{"role": "user", "content": "Hi there!"}]
  }'

curl http://localhost:4000/ollama/api/tags
```

Your applications will now automatically benefit from:
- **Distributed processing** across multiple workers
- **Intelligent load balancing** 
- **Automatic failover** if workers go down
- **Better resource utilization** across your infrastructure

No code changes required - just update the endpoint URL in your configuration.

## Architecture Overview

GridLLM consists of three main components working together:

### 1. **Central Server** (`/server`)

The orchestration hub that manages the entire distributed system:

- **Intelligent Job Scheduler**: Advanced queue management with priority-based routing
- **Worker Registry**: Real-time tracking of worker capabilities, status, and performance metrics
- **Load Balancer**: Smart request distribution based on model availability and current load
- **API Gateway**: Complete Ollama API compatibility plus native endpoints
- **Health Monitor**: Continuous health checks with automatic failover and orphaned job recovery
- **Redis Integration**: Robust job queuing with BullMQ and persistent state management

### 2. **Worker Clients** (`/client`)

Distributed processing nodes that handle actual inference:

- **Ollama Integration**: Seamless connection to local Ollama instances
- **Auto-Discovery**: Automatic detection of available models and system resources
- **Performance Tiering**: Self-classification into high/medium/low performance categories
- **Resource Monitoring**: Real-time CPU, memory, and GPU usage tracking
- **Fault Recovery**: Automatic reconnection and job redistribution on failures
- **Concurrent Processing**: Configurable parallel job execution

### 3. **Redis Message Bus**

Central communication and persistence layer:

- **Job Queuing**: Persistent job queues with priority support
- **Real-time Messaging**: Worker coordination and status updates
- **State Management**: Active job tracking and recovery
- **Health Checking**: Distributed heartbeat monitoring

## Key Features

### **Production-Ready Distributed Architecture**

- **Horizontal Scaling**: Add workers dynamically to increase capacity
- **Fault Tolerance**: Automatic failover and orphaned job recovery
- **Load Balancing**: Intelligent request distribution with performance-aware routing
- **Real-time Monitoring**: Live tracking of worker status, job queues, and system health
- **Zero-Downtime Deployment**: Rolling updates and graceful shutdowns

### **Complete Ollama API Compatibility**

- **Drop-in Replacement**: 100% compatible with existing Ollama clients and tools
- **Full Endpoint Coverage**: All Ollama endpoints supported (`/ollama/*`)
- **Streaming Support**: Real-time token streaming for interactive applications
- **Model Management**: Distributed model availability across workers
- **Advanced Features**: Support for `think` parameter, embeddings, and custom options
- **Backward Compatibility**: Works with all existing Ollama integrations

### **Advanced Job Scheduling & Management**

- **Priority Queues**: High/medium/low priority job processing with configurable weights
- **Timeout Management**: Configurable timeouts with automatic cleanup and retry logic
- **Orphan Recovery**: Automatic detection and requeuing of jobs from failed workers
- **Smart Worker Selection**: Optimal assignment based on:
  - Model availability and compatibility
  - Current worker load and capacity
  - Performance tier and historical metrics
  - Resource utilization (CPU, memory, GPU)

### **Enterprise-Grade Features**

- **Redis Integration**: High-performance job queuing with BullMQ and clustering support
- **Security**: JWT authentication, API key support, and configurable CORS
- **Rate Limiting**: Configurable request throttling and DDoS protection
- **Comprehensive Logging**: Structured logging with Winston, multiple output formats
- **Health Endpoints**: Detailed system status monitoring and metrics
- **Docker Ready**: Full containerization with multi-stage builds and health checks

## API Reference

### Ollama Compatibility Endpoints

GridLLM provides complete compatibility with the Ollama API:

```bash
# Generate completion
curl -X POST http://localhost:3000/ollama/api/generate 
  -H "Content-Type: application/json" 
  -d '{
    "model": "llama3.2",
    "prompt": "Why is the sky blue?",
    "stream": false
  }'

# Chat completion
curl -X POST http://localhost:3000/ollama/api/chat 
  -H "Content-Type: application/json" 
  -d '{
    "model": "llama3.2",
    "messages": [
      {
        "role": "user",
        "content": "What is the capital of France?"
      }
    ]
  }'

# List available models
curl http://localhost:3000/ollama/api/tags

# Pull a model (distributed across workers)
curl -X POST http://localhost:3000/ollama/api/pull 
  -H "Content-Type: application/json" 
  -d '{"name": "llama3.2"}'
```

### Native GridLLM Endpoints

#### Health & Status

```bash
# System health check
GET /health

# Detailed system status
GET /api/status

# Worker information
GET /api/workers

# Job queue status
GET /api/queue/status
```

#### Worker Management

```bash
# Register worker
POST /api/workers/register
{
  "workerId": "worker-001",
  "ollamaHost": "http://localhost:11434",
  "capabilities": ["llama3.2", "codellama"],
  "performanceTier": "high"
}

# Worker heartbeat
POST /api/workers/:workerId/heartbeat
{
  "status": "active",
  "currentJobs": 2,
  "availableModels": ["llama3.2", "codellama"]
}
```

## Development

### Project Structure

```
GridLLM/
├── server/                 # Central orchestration server
│   ├── src/
│   │   ├── routes/        # API endpoints
│   │   ├── services/      # Core business logic
│   │   ├── middleware/    # Express middleware
│   │   └── utils/         # Utilities and helpers
│   ├── Dockerfile
│   └── package.json
├── client/                # Distributed worker clients
│   ├── src/
│   │   ├── routes/        # Client API endpoints
│   │   ├── services/      # Worker services
│   │   ├── middleware/    # Client middleware
│   │   └── utils/         # Client utilities
│   ├── Dockerfile
│   └── package.json
├── tests/                # Test suites
│   ├── server/           # Server tests
│   └── client/           # Client tests
├── docs/                 # Documentation
├── docker-compose.yml    # Docker deployment
└── package.json          # Root package management
```

### Development Setup

1. **Prerequisites**
   ```bash
   # Install Node.js 18+
   node --version  # Should be 18+
   
   # Install Docker
   docker --version
   
   # Install Ollama
   curl -fsSL https://ollama.ai/install.sh | sh
   ```

2. **Environment Setup**
   ```bash
   # Clone and install
   git clone <repository-url>
   cd GridLLM
   npm install
   
   # Install all dependencies
   npm run install:all
   
   # Set up environment files
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```

3. **Development Commands**
   ```bash
   # Start development servers
   npm run dev:server    # Start server in development mode
   npm run dev:client    # Start client in development mode
   npm run dev:all       # Start both server and client
   
   # Building
   npm run build:server  # Build server
   npm run build:client  # Build client
   npm run build:all     # Build everything
   
   # Testing
   npm run test:server   # Run server tests
   npm run test:client   # Run client tests
   npm run test:all      # Run all tests
   
   # Docker operations
   npm run docker:build  # Build Docker images
   npm run docker:up     # Start with Docker Compose
   npm run docker:down   # Stop Docker services
   ```

### Testing

GridLLM includes comprehensive test suites for both server and client components:

```bash
# Run all tests
npm run test

# Run specific test suites
npm run test:server
npm run test:client

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

## Deployment

### Production Deployment with Docker

1. **Prepare Environment**
   ```bash
   # Clone to production server
   git clone <repository-url>
   cd GridLLM
   
   # Configure production environment
   cp docker-compose.prod.yml docker-compose.yml
   ```

2. **Deploy Services**
   ```bash
   # Start complete system
   docker-compose up -d
   
   # Check service status
   docker-compose ps
   
   # View logs
   docker-compose logs -f
   ```

## Monitoring and Observability

### Logging

Structured logging with multiple output formats:

```javascript
// Log configuration
{
  "level": "info",
  "format": "json",
  "transports": [
    {
      "type": "file",
      "filename": "logs/gridllm.log",
      "maxSize": "20m",
      "maxFiles": 5
    },
    {
      "type": "console",
      "format": "simple"
    }
  ]
}
```

### Metrics and Analytics

Key metrics tracked by GridLLM:

- **Job Metrics**: Queue lengths, processing times
- **Worker Metrics**: Active workers, model availability, performance tiers
- **System Metrics**: Redis connectivity, response times

## Troubleshooting

### Common Issues

1. **Worker Connection Issues**
   ```bash
   # Check worker connectivity
   curl http://localhost:3000/health
   
   # Verify Ollama connection
   curl http://localhost:11434/api/tags
   
   # Check server registration
   curl http://localhost:4000/api/workers
   ```

2. **Redis Connection Problems**
   ```bash
   # Test Redis connectivity
   redis-cli ping
   
   # Check Redis logs
   docker logs redis
   
   # Verify Redis configuration
   redis-cli info
   ```

3. **Job Processing Issues**
   ```bash
   # Check job queues
   curl http://localhost:4000/api/queue/status
   
   # View active jobs
   curl http://localhost:4000/api/jobs/active
   
   # Monitor job logs
   tail -f server/logs/gridllm-server.log | grep "job"
   ```

### Debug Mode

Enable detailed debugging:

```bash
# Server debug mode
export DEBUG=gridllm:server:*
export LOG_LEVEL=debug
npm run dev:server

# Client debug mode
export DEBUG=gridllm:client:*
export LOG_LEVEL=debug
npm run dev:client
```

### Performance Tuning

Optimize GridLLM for your workload:

1. **Worker Scaling**
   - Use 1 worker per computer
   - Monitor queue lengths and adjust worker count
   - Use performance tiers to optimize job distribution

2. **Redis Optimization**
   - Configure Redis persistence for job durability
   - Adjust memory limits based on job volume
   - Use Redis clustering for high availability

3. **Timeout Configuration**
   - Set job timeouts based on model complexity
   - Configure worker heartbeat intervals
   - Adjust cleanup intervals for optimal performance

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
