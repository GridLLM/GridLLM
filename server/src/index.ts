import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { config } from "@/config";
import { logger } from "@/utils/logger";
import { RedisService } from "@/services/RedisService";
import { WorkerRegistry } from "@/services/WorkerRegistry";
import { JobScheduler } from "@/services/JobScheduler";
import { healthRoutes } from "@/routes/health";
import { inferenceRoutes } from "@/routes/inference";
import { ollamaRoutes } from "@/routes/ollama";
import { errorHandler, notFoundHandler } from "@/middleware/errorHandler";

class GridLLMServer {
	private app: express.Application;
	private server: any;
	private redis: RedisService;
	private workerRegistry: WorkerRegistry;
	private jobScheduler: JobScheduler;

	constructor() {
		this.app = express();
		this.redis = RedisService.getInstance();
		this.workerRegistry = new WorkerRegistry();
		this.jobScheduler = new JobScheduler(this.workerRegistry);

		this.setupMiddleware();
		this.setupRoutes();
		this.setupErrorHandling();
		this.setupEventHandlers();
	}

	private setupMiddleware(): void {
		// Security middleware
		this.app.use(helmet());
		this.app.use(
			cors({
				origin: process.env.CORS_ORIGIN || "*",
				methods: ["GET", "POST", "PUT", "DELETE"],
				allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
			})
		);

		// General middleware
		this.app.use(compression());
		this.app.use(express.json({ limit: "10mb" }));
		this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));

		// Request logging
		this.app.use((req, res, next) => {
			logger.info("Incoming request", {
				method: req.method,
				url: req.url,
				ip: req.ip,
				userAgent: req.get("User-Agent"),
			});
			next();
		});
	}

	private setupRoutes(): void {
		// Health routes
		this.app.use(
			"/health",
			healthRoutes(this.workerRegistry, this.jobScheduler, this.redis)
		);

		// Inference routes
		this.app.use(
			"/inference",
			inferenceRoutes(this.jobScheduler, this.workerRegistry)
		);

		// Ollama API routes - exact replica of Ollama functionality
		this.app.use(
			"/ollama",
			ollamaRoutes(this.jobScheduler, this.workerRegistry)
		);

		// Root endpoint
		this.app.get("/", (req, res) => {
			res.json({
				name: "GridLLM Server",
				version: "1.0.0",
				status: "running",
				serverId: config.server.id,
				workers: {
					total: this.workerRegistry.getWorkerCount(),
					online: this.workerRegistry.getOnlineWorkerCount(),
					available: this.workerRegistry.getAvailableWorkerCount(),
				},
				jobs: {
					active: this.jobScheduler.getActiveJobCount(),
					queued: this.jobScheduler.getQueuedJobCount(),
				},
				endpoints: {
					health: "/health",
					inference: "/inference",
					ollama: "/ollama",
				},
				timestamp: new Date().toISOString(),
			});
		});

		// 404 handler
		this.app.use("*", notFoundHandler);
	}

	private setupErrorHandling(): void {
		this.app.use(errorHandler);
	}

	private setupEventHandlers(): void {
		// Worker registry events
		this.workerRegistry.on("worker_registered", (worker) => {
			logger.worker(worker.workerId, "Worker registered with server", {
				models: worker.capabilities.availableModels.length,
				performanceTier: worker.capabilities.performanceTier,
			});
		});

		this.workerRegistry.on("worker_removed", (worker) => {
			logger.worker(worker.workerId, "Worker removed from server");
		});

		this.workerRegistry.on("worker_status_changed", (worker) => {
			logger.worker(worker.workerId, "Worker status changed", {
				status: worker.status,
				currentJobs: worker.currentJobs,
			});
		});

		// Job scheduler events
		this.jobScheduler.on("job_queued", (job) => {
			logger.job(job.id, "Job queued", {
				model: job.model,
				priority: job.priority,
				queuePosition: this.jobScheduler.getQueuedJobCount(),
			});
		});

		this.jobScheduler.on("job_assigned", (assignment) => {
			logger.job(assignment.jobId, "Job assigned to worker", {
				workerId: assignment.workerId,
				model: assignment.request.model,
			});
		});

		this.jobScheduler.on("job_completed", (data) => {
			logger.job(data.jobAssignment.jobId, "Job completed", {
				workerId: data.workerId,
				model: data.jobAssignment.request.model,
				duration:
					Date.now() -
					new Date(data.jobAssignment.assignedAt).getTime(),
			});
		});

		this.jobScheduler.on("job_failed", (data) => {
			logger.job(data.jobAssignment.jobId, "Job failed", {
				workerId: data.workerId,
				error: data.error,
				model: data.jobAssignment.request.model,
			});
		});

		this.jobScheduler.on("job_timeout", (data) => {
			logger.job(data.jobAssignment.jobId, "Job timed out", {
				workerId: data.workerId,
				timeout: data.jobAssignment.timeout,
			});
		});

		// Process events
		process.on("SIGTERM", () => {
			logger.info("SIGTERM received, shutting down gracefully");
			this.shutdown();
		});

		process.on("SIGINT", () => {
			logger.info("SIGINT received, shutting down gracefully");
			this.shutdown();
		});

		process.on("uncaughtException", (error) => {
			logger.error("Uncaught exception", error);
			this.shutdown(1);
		});

		process.on("unhandledRejection", (reason, promise) => {
			logger.error("Unhandled rejection", { reason, promise });
			this.shutdown(1);
		});
	}

	async start(): Promise<void> {
		try {
			logger.info("Starting GridLLM Server", {
				serverId: config.server.id,
				environment: config.env,
				port: config.port,
			});

			// Initialize Redis connection
			await this.redis.connect();
			logger.info("Redis connected successfully");

			// Initialize worker registry
			await this.workerRegistry.initialize();
			logger.info("Worker registry initialized");

			// Initialize job scheduler
			await this.jobScheduler.initialize();
			logger.info("Job scheduler initialized");

			// Start HTTP server
			this.server = this.app.listen(config.port, () => {
				logger.info("GridLLM Server started successfully", {
					port: config.port,
					serverId: config.server.id,
					environment: config.env,
				});
			});

			this.server.on("error", (error: any) => {
				logger.error("Server error", error);
				this.shutdown(1);
			});

			// Log periodic status
			setInterval(() => {
				logger.performance("Server status", {
					workers: {
						total: this.workerRegistry.getWorkerCount(),
						online: this.workerRegistry.getOnlineWorkerCount(),
						available:
							this.workerRegistry.getAvailableWorkerCount(),
					},
					jobs: {
						active: this.jobScheduler.getActiveJobCount(),
						queued: this.jobScheduler.getQueuedJobCount(),
					},
					memory: {
						used: Math.round(
							process.memoryUsage().heapUsed / 1024 / 1024
						),
						total: Math.round(
							process.memoryUsage().heapTotal / 1024 / 1024
						),
					},
				});
			}, 60000); // Every minute
		} catch (error) {
			logger.error("Failed to start GridLLM Server", error);
			throw error;
		}
	}

	async shutdown(exitCode: number = 0): Promise<void> {
		logger.info("Shutting down GridLLM Server", { exitCode });

		try {
			// Stop accepting new connections
			if (this.server) {
				this.server.close(() => {
					logger.info("HTTP server closed");
				});
			}

			// Stop job scheduler (waits for active jobs)
			await this.jobScheduler.stop();
			logger.info("Job scheduler stopped");

			// Stop worker registry
			await this.workerRegistry.stop();
			logger.info("Worker registry stopped");

			// Disconnect from Redis
			await this.redis.disconnect();
			logger.info("Redis disconnected");

			logger.info("GridLLM Server shutdown complete");
			process.exit(exitCode);
		} catch (error) {
			logger.error("Error during shutdown", error);
			process.exit(1);
		}
	}

	getApp(): express.Application {
		return this.app;
	}

	getWorkerRegistry(): WorkerRegistry {
		return this.workerRegistry;
	}

	getJobScheduler(): JobScheduler {
		return this.jobScheduler;
	}

	getRedis(): RedisService {
		return this.redis;
	}
}

// Start the server if this file is run directly
if (require.main === module) {
	const server = new GridLLMServer();

	server.start().catch((error) => {
		logger.error("Failed to start GridLLM Server", error);
		process.exit(1);
	});
}

export default GridLLMServer;
