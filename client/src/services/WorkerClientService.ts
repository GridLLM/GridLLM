import { EventEmitter } from "events";
import { config } from "@/config";
import { logger } from "@/utils/logger";
import { RedisConnectionManager } from "./RedisConnectionManager";
import { OllamaService } from "./OllamaService";
import {
	NodeCapabilities,
	WorkerStatus,
	SystemResources,
	InferenceRequest,
	InferenceResponse,
} from "@/types";

export class WorkerClientService extends EventEmitter {
	private redisManager: RedisConnectionManager;
	private ollamaService: OllamaService;
	private isConnected: boolean = false;
	private reconnectAttempts: number = 0;
	private heartbeatInterval: NodeJS.Timeout | null = null;
	private resourceCheckInterval: NodeJS.Timeout | null = null;
	private capabilities: NodeCapabilities | null = null;
	private currentJobs: number = 0;
	private isProcessingJob: boolean = false;
	private lastPublishedStatus: {
		status: string;
		currentJobs: number;
		systemResources?: any;
	} | null = null;

	constructor() {
		super();
		this.redisManager = RedisConnectionManager.getInstance();
		this.ollamaService = new OllamaService();
	}

	async initialize(): Promise<void> {
		try {
			logger.info("Initializing worker client service");

			// Connect to server's Redis
			await this.redisManager.connect();

			// Check Ollama health
			const ollamaHealthy = await this.ollamaService.checkHealth();
			if (!ollamaHealthy) {
				throw new Error("Ollama service is not available");
			}

			// Gather node capabilities
			this.capabilities = await this.gatherNodeCapabilities();

			// Setup event listeners
			this.setupEventListeners();

			logger.info("Worker client service initialized successfully");
		} catch (error) {
			logger.error("Failed to initialize worker client service", error);
			throw error;
		}
	}

	async start(): Promise<void> {
		try {
			if (!this.capabilities) {
				throw new Error(
					"Service not initialized. Call initialize() first."
				);
			}

			logger.info("Starting worker client service");

			// Connect to server
			await this.connectToServer();

			// Start heartbeat
			this.startHeartbeat();

			// Start resource monitoring
			this.startResourceMonitoring();

			// Start job processing
			this.startJobProcessing();

			this.isConnected = true;
			this.emit("connected");

			logger.info("Worker client service started successfully");
		} catch (error) {
			logger.error("Failed to start worker client service", error);
			throw error;
		}
	}

	async stop(): Promise<void> {
		try {
			logger.info("Stopping worker client service");

			this.isConnected = false;

			// Stop intervals
			if (this.heartbeatInterval) {
				clearInterval(this.heartbeatInterval);
				this.heartbeatInterval = null;
			}

			if (this.resourceCheckInterval) {
				clearInterval(this.resourceCheckInterval);
				this.resourceCheckInterval = null;
			}

			// Wait for current job to complete
			while (this.isProcessingJob) {
				logger.info("Waiting for current job to complete...");
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			// Disconnect from server
			await this.disconnectFromServer();

			// Disconnect from Redis
			await this.redisManager.disconnect();

			this.emit("disconnected");

			logger.info("Worker client service stopped successfully");
		} catch (error) {
			logger.error("Error stopping worker client service", error);
			throw error;
		}
	}

	private async gatherNodeCapabilities(): Promise<NodeCapabilities> {
		try {
			logger.info("Gathering node capabilities");

			const models = await this.ollamaService.getAvailableModels();
			const systemResources =
				await this.ollamaService.getSystemResources();

			const capabilities: NodeCapabilities = {
				workerId: config.worker.id,
				availableModels: models,
				systemResources,
				performanceTier: this.determinePerformanceTier(systemResources),
				maxConcurrentTasks: config.worker.maxConcurrentJobs,
				supportedFormats: ["json", "text"],
				lastUpdated: new Date(),
			};

			logger.info("Node capabilities gathered", {
				workerId: capabilities.workerId,
				modelCount: capabilities.availableModels.length,
				performanceTier: capabilities.performanceTier,
				maxConcurrentTasks: capabilities.maxConcurrentTasks,
			});

			return capabilities;
		} catch (error) {
			logger.error("Failed to gather node capabilities", error);
			throw error;
		}
	}

	private determinePerformanceTier(
		resources: SystemResources
	): "high" | "medium" | "low" {
		const cpuScore =
			resources.cpuCores >= 8 ? 3 : resources.cpuCores >= 4 ? 2 : 1;
		const memoryScore =
			resources.totalMemoryMB >= 16384
				? 3
				: resources.totalMemoryMB >= 8192
					? 2
					: 1;
		const gpuScore = resources.gpuMemoryMB
			? resources.gpuMemoryMB >= 16384
				? 3
				: 2
			: 0;

		const totalScore = cpuScore + memoryScore + gpuScore;

		if (totalScore >= 7) return "high";
		if (totalScore >= 4) return "medium";
		return "low";
	}

	private async connectToServer(): Promise<void> {
		try {
			logger.info("Connecting to server");

			// Register with server
			await this.registerWithServer();

			// Subscribe to worker-specific job channel
			await this.subscribeToJobChannel();

			this.reconnectAttempts = 0;
			logger.info("Connected to server successfully");
		} catch (error) {
			logger.error("Failed to connect to server", error);
			await this.handleConnectionError();
			throw error;
		}
	}

	private async registerWithServer(): Promise<void> {
		if (!this.capabilities) {
			throw new Error("Node capabilities not available");
		}

		try {
			const registrationData = {
				workerId: config.worker.id,
				capabilities: this.capabilities,
				status: "online",
				registeredAt: new Date().toISOString(),
			};

			await this.redisManager.hset(
				"workers",
				config.worker.id,
				JSON.stringify(registrationData)
			);

			await this.redisManager.publish(
				"worker:registered",
				JSON.stringify(registrationData)
			);

			logger.info("Registered with server", {
				workerId: config.worker.id,
			});
		} catch (error) {
			logger.error("Failed to register with server", error);
			throw error;
		}
	}

	private async subscribeToJobChannel(): Promise<void> {
		try {
			// Subscribe to worker-specific job assignments
			await this.redisManager.subscribe(
				`worker:${config.worker.id}:job`,
				this.handleJobMessage.bind(this)
			);

			// Subscribe to re-registration requests
			await this.redisManager.subscribe(
				`worker:reregister:${config.worker.id}`,
				this.handleReregistrationRequest.bind(this)
			);

			logger.info("Subscribed to job and reregistration channels");
		} catch (error) {
			logger.error("Failed to subscribe to job channel", error);
			throw error;
		}
	}

	private async disconnectFromServer(): Promise<void> {
		try {
			if (!this.isConnected) return;

			logger.info("Disconnecting from server");

			// Unregister from server
			await this.unregisterFromServer();

			// Unsubscribe from channels
			await this.redisManager.unsubscribe(
				`worker:${config.worker.id}:job`
			);
			await this.redisManager.unsubscribe(
				`worker:reregister:${config.worker.id}`
			);

			logger.info("Disconnected from server");
		} catch (error) {
			logger.error("Error disconnecting from server", error);
		}
	}

	private async unregisterFromServer(): Promise<void> {
		try {
			await this.redisManager.delete(`workers:${config.worker.id}`);

			await this.redisManager.publish(
				"worker:unregistered",
				JSON.stringify({
					workerId: config.worker.id,
					timestamp: new Date().toISOString(),
				})
			);

			logger.info("Unregistered from server");
		} catch (error) {
			logger.error("Failed to unregister from server", error);
		}
	}

	private setupEventListeners(): void {
		// Handle Redis connection events
		this.redisManager.getMainConnection().on("error", (error) => {
			logger.error("Redis connection error", error);
			this.handleConnectionError();
		});

		this.redisManager.getMainConnection().on("close", () => {
			logger.warn("Redis connection closed");
			this.handleConnectionError();
		});
	}

	private async handleConnectionError(): Promise<void> {
		this.isConnected = false;
		this.emit("connection_error");

		if (this.reconnectAttempts < config.server.maxReconnectAttempts) {
			this.reconnectAttempts++;
			const delay =
				config.server.reconnectDelay *
				Math.pow(2, this.reconnectAttempts - 1);

			logger.info("Attempting to reconnect to server", {
				attempt: this.reconnectAttempts,
				delay,
			});

			setTimeout(async () => {
				try {
					await this.connectToServer();
					this.isConnected = true;
					this.emit("reconnected");
				} catch (error) {
					logger.error("Reconnection attempt failed", error);
					this.handleConnectionError();
				}
			}, delay);
		} else {
			logger.error("Max reconnection attempts reached");
			this.emit("max_reconnect_attempts_reached");
		}
	}

	private startHeartbeat(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
		}

		this.heartbeatInterval = setInterval(async () => {
			try {
				await this.sendHeartbeat();
			} catch (error) {
				logger.error("Heartbeat failed", error);
				this.handleConnectionError();
			}
		}, config.server.heartbeatInterval);

		logger.info("Heartbeat started", {
			interval: config.server.heartbeatInterval,
		});
	}

	private async sendHeartbeat(): Promise<void> {
		const status = this.getWorkerStatus();

		const heartbeatData = {
			workerId: config.worker.id,
			status: status.status,
			timestamp: new Date().toISOString(),
			currentJobs: status.currentJobs,
			connectionHealth: status.connectionHealth,
		};

		await this.redisManager.setWithExpiry(
			`heartbeat:${config.worker.id}`,
			JSON.stringify(heartbeatData),
			(config.server.heartbeatInterval * 2) / 1000 // TTL is 2x heartbeat interval
		);

		await this.redisManager.publish(
			"worker:heartbeat",
			JSON.stringify(heartbeatData)
		);

		logger.debug("Heartbeat sent", { workerId: config.worker.id });
	}

	private startResourceMonitoring(): void {
		if (this.resourceCheckInterval) {
			clearInterval(this.resourceCheckInterval);
		}

		this.resourceCheckInterval = setInterval(async () => {
			try {
				await this.updateCapabilities();
			} catch (error) {
				logger.error("Resource monitoring failed", error);
			}
		}, config.worker.resourceCheckInterval);

		logger.info("Resource monitoring started", {
			interval: config.worker.resourceCheckInterval,
		});
	}

	private async updateCapabilities(): Promise<void> {
		if (!this.capabilities) return;

		try {
			const systemResources =
				await this.ollamaService.getSystemResources();

			// Update capabilities
			this.capabilities.systemResources = systemResources;
			this.capabilities.lastUpdated = new Date();

			const currentStatus = this.isProcessingJob ? "busy" : "online";
			const currentStatusData = {
				status: currentStatus,
				currentJobs: this.currentJobs,
				systemResources,
			};

			// Check if status has actually changed
			const hasStatusChanged =
				!this.lastPublishedStatus ||
				this.lastPublishedStatus.status !== currentStatus ||
				this.lastPublishedStatus.currentJobs !== this.currentJobs ||
				this.hasSystemResourcesChanged(
					this.lastPublishedStatus.systemResources,
					systemResources
				);

			if (!hasStatusChanged) {
				// Only update capabilities in Redis without publishing status update
				await this.redisManager.hset(
					"workers",
					config.worker.id,
					JSON.stringify({
						workerId: config.worker.id,
						capabilities: this.capabilities,
						status: currentStatus,
						lastUpdated: new Date().toISOString(),
					})
				);
				return;
			}

			// Status has changed, publish the update
			await this.redisManager.hset(
				"workers",
				config.worker.id,
				JSON.stringify({
					workerId: config.worker.id,
					capabilities: this.capabilities,
					status: currentStatus,
					lastUpdated: new Date().toISOString(),
				})
			);

			// Publish status update only when something meaningful changed
			await this.redisManager.publish(
				"worker:status_update",
				JSON.stringify({
					workerId: config.worker.id,
					status: currentStatus,
					currentJobs: this.currentJobs,
					systemResources,
				})
			);

			// Update the last published status
			this.lastPublishedStatus = { ...currentStatusData };

			logger.debug("Worker status published due to meaningful change", {
				workerId: config.worker.id,
				status: currentStatus,
				currentJobs: this.currentJobs,
			});
		} catch (error) {
			logger.error("Failed to update capabilities", error);
		}
	}

	private hasSystemResourcesChanged(
		oldResources: any,
		newResources: any
	): boolean {
		if (!oldResources && !newResources) return false;
		if (!oldResources || !newResources) return true;

		// Check for significant changes in system resources
		// Only consider meaningful differences (e.g., >5% change in memory/CPU)
		const threshold = 0.05; // 5% threshold

		if (oldResources.memory && newResources.memory) {
			const memDiff =
				Math.abs(oldResources.memory.used - newResources.memory.used) /
				oldResources.memory.total;
			if (memDiff > threshold) return true;
		}

		if (oldResources.cpu && newResources.cpu) {
			const cpuDiff = Math.abs(
				oldResources.cpu.usage - newResources.cpu.usage
			);
			if (cpuDiff > threshold * 100) return true; // CPU is in percentage
		}

		return false;
	}

	private async publishStatusUpdate(): Promise<void> {
		if (!this.capabilities) return;

		try {
			const systemResources =
				await this.ollamaService.getSystemResources();
			const currentStatus = this.isProcessingJob ? "busy" : "online";

			// Always publish when explicitly called (for job state changes)
			await this.redisManager.publish(
				"worker:status_update",
				JSON.stringify({
					workerId: config.worker.id,
					status: currentStatus,
					currentJobs: this.currentJobs,
					systemResources,
				})
			);

			// Update the last published status
			this.lastPublishedStatus = {
				status: currentStatus,
				currentJobs: this.currentJobs,
				systemResources,
			};

			logger.debug("Worker status published", {
				workerId: config.worker.id,
				status: currentStatus,
				currentJobs: this.currentJobs,
			});
		} catch (error) {
			logger.error("Failed to publish status update", error);
		}
	}

	private startJobProcessing(): void {
		logger.info("Started job processing");
	}

	private async handleJobMessage(message: string): Promise<void> {
		try {
			const data = JSON.parse(message);
			logger.debug("Received job message", { type: data.type });

			switch (data.type) {
				case "job_assignment":
					await this.processJobAssignment(data.job);
					break;
				case "job_cancellation":
					await this.handleJobCancellation(data.jobId);
					break;
				default:
					logger.warn("Unknown job message type", {
						type: data.type,
					});
			}
		} catch (error) {
			logger.error("Failed to handle job message", { message, error });
		}
	}

	private async processJobAssignment(assignment: any): Promise<void> {
		const request: InferenceRequest = assignment.request;

		if (this.isProcessingJob) {
			logger.warn("Received job assignment while busy", {
				jobId: request.id,
			});
			return;
		}

		this.isProcessingJob = true;
		this.currentJobs = 1;

		// Immediately publish status change to busy
		await this.publishStatusUpdate();

		try {
			logger.info("Processing job assignment", {
				jobId: request.id,
				model: request.model,
			});

			// Validate model availability
			const isModelValid = await this.ollamaService.validateModel(
				request.model
			);
			if (!isModelValid) {
				throw new Error(`Model ${request.model} is not available`);
			}

			// Process inference
			let result: InferenceResponse | undefined;

			if (request.stream) {
				// For streaming, collect the full response
				let fullResponse = "";
				for await (const chunk of this.ollamaService.generateStreamResponse(
					request
				)) {
					fullResponse += chunk.response;

					if (chunk.done) {
						result = {
							id: request.id,
							response: fullResponse,
							done: true,
						};
						break;
					}
				}
			} else {
				result = await this.ollamaService.generateResponse(request);
			}

			if (!result) {
				throw new Error("No result generated from inference");
			}

			// Notify server of completion
			await this.redisManager.publish(
				"job:completed",
				JSON.stringify({
					jobId: request.id,
					workerId: config.worker.id,
					result,
					timestamp: new Date().toISOString(),
				})
			);

			// Publish result to specific job channel for synchronous waiting
			await this.redisManager.publish(
				`job:result:${request.id}`,
				JSON.stringify({
					jobId: request.id,
					workerId: config.worker.id,
					result,
					timestamp: new Date().toISOString(),
				})
			);

			logger.info("Job completed successfully", {
				jobId: request.id,
				model: request.model,
			});
		} catch (error) {
			logger.error("Job processing failed", {
				jobId: request.id,
				error: error instanceof Error ? error.message : "Unknown error",
			});

			// Notify server of failure
			await this.redisManager.publish(
				"job:failed",
				JSON.stringify({
					jobId: request.id,
					workerId: config.worker.id,
					error:
						error instanceof Error
							? error.message
							: "Unknown error",
					timestamp: new Date().toISOString(),
				})
			);

			// Publish error to specific job channel
			await this.redisManager.publish(
				`job:result:${request.id}`,
				JSON.stringify({
					jobId: request.id,
					workerId: config.worker.id,
					error:
						error instanceof Error
							? error.message
							: "Unknown error",
					timestamp: new Date().toISOString(),
				})
			);
		} finally {
			this.isProcessingJob = false;
			this.currentJobs = 0;

			// Immediately publish status change to idle
			await this.publishStatusUpdate();
		}
	}

	private async handleJobCancellation(jobId: string): Promise<void> {
		logger.info("Job cancellation requested", { jobId });
		// In a real implementation, you'd cancel the running job
		// For now, just log it
	}

	private async handleReregistrationRequest(message: string): Promise<void> {
		try {
			const data = JSON.parse(message);
			logger.info("Received re-registration request from server", {
				workerId: data.workerId,
				reason: data.reason,
			});

			// Re-register with the server
			await this.registerWithServer();

			logger.info("Re-registration completed successfully");
		} catch (error) {
			logger.error("Failed to handle re-registration request", error);
		}
	}

	// Public methods
	getWorkerStatus(): WorkerStatus {
		return {
			id: config.worker.id,
			status: this.isProcessingJob
				? "busy"
				: this.isConnected
					? "online"
					: "offline",
			currentJobs: [], // For now, simplified to empty array
			capabilities: this.capabilities || ({} as NodeCapabilities),
			lastHeartbeat: new Date(),
			connectionHealth: this.isConnected ? "healthy" : "poor",
		};
	}

	getConnectionStatus(): any {
		return {
			isConnected: this.isConnected,
			reconnectAttempts: this.reconnectAttempts,
			lastConnected: this.isConnected ? new Date() : undefined,
		};
	}

	getCapabilities(): NodeCapabilities | null {
		return this.capabilities;
	}
}

export default WorkerClientService;
