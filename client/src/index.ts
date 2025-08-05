import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { config } from "@/config";
import { logger } from "@/utils/logger";
import { WorkerClientService } from "@/services/WorkerClientService";
import { healthRoutes } from "@/routes/health";
import { errorHandler } from "@/middleware/errorHandler";

class WorkerApplication {
	private app: express.Application;
	private workerClient: WorkerClientService;
	private server: any;

	constructor() {
		this.app = express();
		this.workerClient = new WorkerClientService();
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
		// Health routes only (no inference routes on worker)
		this.app.use("/health", healthRoutes);

		// Root endpoint
		this.app.get("/", (req, res) => {
			const status = this.workerClient.getWorkerStatus();
			const capabilities = this.workerClient.getCapabilities();

			res.json({
				name: "GridLLM Worker",
				version: "1.0.0",
				status: "running",
				workerId: config.worker.id,
				workerStatus: status.status,
				connectedToServer: this.workerClient.getConnectionStatus().isConnected,
				availableModels: capabilities?.availableModels.length || 0,
				timestamp: new Date().toISOString(),
			});
		});

		// Worker status endpoint
		this.app.get("/worker/status", (req, res) => {
			res.json({
				worker: this.workerClient.getWorkerStatus(),
				connection: this.workerClient.getConnectionStatus(),
				capabilities: this.workerClient.getCapabilities(),
				timestamp: new Date().toISOString(),
			});
		});

		// 404 handler
		this.app.use("*", (req, res) => {
			res.status(404).json({
				error: "Route not found",
				path: req.originalUrl,
			});
		});
	}

	private setupErrorHandling(): void {
		this.app.use(errorHandler);
	}

	private setupEventHandlers(): void {
		// Worker client events
		this.workerClient.on("connected", () => {
			logger.info("Worker client connected to server");
		});

		this.workerClient.on("disconnected", () => {
			logger.warn("Worker client disconnected from server");
		});

		this.workerClient.on("connection_error", () => {
			logger.error("Worker client connection error");
		});

		this.workerClient.on("reconnected", () => {
			logger.info("Worker client reconnected to server");
		});

		this.workerClient.on("max_reconnect_attempts_reached", () => {
			logger.error("Max reconnect attempts reached, shutting down");
			this.shutdown();
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
			logger.info("Starting worker application");

			// Initialize and start worker client
			await this.workerClient.initialize();
			await this.workerClient.start();

			// Start HTTP server for health checks
			this.server = this.app.listen(config.port, () => {
				logger.info("Worker application started successfully", {
					port: config.port,
					env: config.env,
					workerId: config.worker.id,
					serverHost: config.server.host,
					serverPort: config.server.port,
				});
			});

			this.server.on("error", (error: any) => {
				logger.error("Server error", error);
				this.shutdown(1);
			});
		} catch (error) {
			logger.error("Failed to start worker application", error);
			throw error;
		}
	}

	async shutdown(exitCode: number = 0): Promise<void> {
		logger.info("Shutting down worker application", { exitCode });

		try {
			// Stop accepting new connections
			if (this.server) {
				this.server.close(() => {
					logger.info("HTTP server closed");
				});
			}

			// Stop worker client
			await this.workerClient.stop();

			logger.info("Worker application shutdown complete");
			process.exit(exitCode);
		} catch (error) {
			logger.error("Error during shutdown", error);
			process.exit(1);
		}
	}

	getApp(): express.Application {
		return this.app;
	}

	getWorkerClient(): WorkerClientService {
		return this.workerClient;
	}
}

// Start the application if this file is run directly
if (require.main === module) {
	const app = new WorkerApplication();

	app.start().catch((error) => {
		logger.error("Failed to start worker application", error);
		process.exit(1);
	});
}

export default WorkerApplication;
