import { EventEmitter } from "events";
import { config } from "@/config";
import { logger } from "@/utils/logger";
import { RedisConnectionManager } from "./RedisConnectionManager";
import { OllamaService } from "./OllamaService";
import { WorkQueueService } from "./WorkQueueService";
import {
	NodeCapabilities,
	WorkerStatus,
	BrokerConnection,
	SystemResources,
	InferenceRequest,
	InferenceResponse,
} from "@/types";
import { Job } from "bullmq";

export class BrokerClientService extends EventEmitter {
	private redisManager: RedisConnectionManager;
	private ollamaService: OllamaService;
	private workQueueService: WorkQueueService | null = null;
	private isConnected: boolean = false;
	private reconnectAttempts: number = 0;
	private heartbeatInterval: NodeJS.Timeout | null = null;
	private resourceCheckInterval: NodeJS.Timeout | null = null;
	private capabilities: NodeCapabilities | null = null;

	constructor() {
		super();
		this.redisManager = RedisConnectionManager.getInstance();
		this.ollamaService = new OllamaService();
	}

	async initialize(): Promise<void> {
		try {
			logger.info("Initializing broker client service");

			// Connect to Redis
			await this.redisManager.connect();

			// Check Ollama health
			const ollamaHealthy = await this.ollamaService.checkHealth();
			if (!ollamaHealthy) {
				throw new Error("Ollama service is not available");
			}

			// Gather node capabilities
			this.capabilities = await this.gatherNodeCapabilities();

			// Initialize work queue service
			this.workQueueService = new WorkQueueService(
				config.worker.id,
				this.capabilities,
				this.processInferenceJob.bind(this)
			);

			// Setup event listeners
			this.setupEventListeners();

			logger.info("Broker client service initialized successfully");
		} catch (error) {
			logger.error("Failed to initialize broker client service", error);
			throw error;
		}
	}

	async start(): Promise<void> {
		try {
			if (!this.workQueueService || !this.capabilities) {
				throw new Error(
					"Service not initialized. Call initialize() first."
				);
			}

			logger.info("Starting broker client service");

			// Start work queue service
			await this.workQueueService.start();

			// Connect to broker
			await this.connectToBroker();

			// Start heartbeat
			this.startHeartbeat();

			// Start resource monitoring
			this.startResourceMonitoring();

			this.isConnected = true;
			this.emit("connected");

			logger.info("Broker client service started successfully");
		} catch (error) {
			logger.error("Failed to start broker client service", error);
			throw error;
		}
	}

	async stop(): Promise<void> {
		try {
			logger.info("Stopping broker client service");

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

			// Stop work queue service
			if (this.workQueueService) {
				await this.workQueueService.stop();
			}

			// Disconnect from broker
			await this.disconnectFromBroker();

			// Disconnect from Redis
			await this.redisManager.disconnect();

			this.emit("disconnected");

			logger.info("Broker client service stopped successfully");
		} catch (error) {
			logger.error("Error stopping broker client service", error);
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
		// Determine performance tier based on system resources
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

	private async connectToBroker(): Promise<void> {
		try {
			logger.info("Connecting to broker");

			// Authenticate with broker
			await this.authenticate();

			// Register with broker
			await this.registerWithBroker();

			// Subscribe to relevant channels
			await this.subscribeToChannels();

			this.reconnectAttempts = 0;
			logger.info("Connected to broker successfully");
		} catch (error) {
			logger.error("Failed to connect to broker", error);
			await this.handleConnectionError();
			throw error;
		}
	}

	private async authenticate(): Promise<void> {
		try {
			const authPayload = {
				workerId: config.worker.id,
				token: config.broker.authToken,
				timestamp: Date.now(),
			};

			await this.redisManager.setWithExpiry(
				`auth:${config.worker.id}`,
				JSON.stringify(authPayload),
				3600 // 1 hour
			);

			logger.debug("Authentication successful");
		} catch (error) {
			logger.error("Authentication failed", error);
			throw new Error("Failed to authenticate with broker");
		}
	}

	private async registerWithBroker(): Promise<void> {
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

			logger.info("Registered with broker", {
				workerId: config.worker.id,
			});
		} catch (error) {
			logger.error("Failed to register with broker", error);
			throw error;
		}
	}

	private async subscribeToChannels(): Promise<void> {
		try {
			// Subscribe to worker-specific channel
			await this.redisManager.subscribe(
				`worker:${config.worker.id}`,
				this.handleWorkerMessage.bind(this)
			);

			// Subscribe to broadcast channel
			await this.redisManager.subscribe(
				"broadcast",
				this.handleBroadcastMessage.bind(this)
			);

			// Subscribe to system events
			await this.redisManager.subscribe(
				"system:events",
				this.handleSystemEvent.bind(this)
			);

			logger.info("Subscribed to broker channels");
		} catch (error) {
			logger.error("Failed to subscribe to channels", error);
			throw error;
		}
	}

	private async disconnectFromBroker(): Promise<void> {
		try {
			if (!this.isConnected) return;

			logger.info("Disconnecting from broker");

			// Unregister from broker
			await this.unregisterFromBroker();

			// Unsubscribe from channels
			await this.redisManager.unsubscribe(`worker:${config.worker.id}`);
			await this.redisManager.unsubscribe("broadcast");
			await this.redisManager.unsubscribe("system:events");

			logger.info("Disconnected from broker");
		} catch (error) {
			logger.error("Error disconnecting from broker", error);
		}
	}

	private async unregisterFromBroker(): Promise<void> {
		try {
			await this.redisManager.delete(`workers:${config.worker.id}`);

			await this.redisManager.publish(
				"worker:unregistered",
				JSON.stringify({
					workerId: config.worker.id,
					timestamp: new Date().toISOString(),
				})
			);

			logger.info("Unregistered from broker");
		} catch (error) {
			logger.error("Failed to unregister from broker", error);
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

		if (this.reconnectAttempts < config.broker.maxReconnectAttempts) {
			this.reconnectAttempts++;
			const delay =
				config.broker.reconnectDelay *
				Math.pow(2, this.reconnectAttempts - 1);

			logger.info("Attempting to reconnect to broker", {
				attempt: this.reconnectAttempts,
				delay,
			});

			setTimeout(async () => {
				try {
					await this.connectToBroker();
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
		}, config.broker.heartbeatInterval);

		logger.info("Heartbeat started", {
			interval: config.broker.heartbeatInterval,
		});
	}

	private async sendHeartbeat(): Promise<void> {
		if (!this.workQueueService) return;

		const status = await this.workQueueService.getWorkerStatus();

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
			(config.broker.heartbeatInterval * 2) / 1000 // TTL is 2x heartbeat interval
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

			// Check if resources are within acceptable limits
			// if (this.shouldPauseWorker(systemResources)) {
			//   logger.warn('Resource usage high, pausing worker', {
			//     cpuUsage: systemResources.cpuUsagePercent,
			//     memoryUsage: systemResources.memoryUsagePercent,
			//   });

			//   if (this.workQueueService) {
			//     await this.workQueueService.pause();
			//   }
			//   return;
			// }

			// Resume worker if it was paused
			if (this.workQueueService) {
				await this.workQueueService.resume();
			}

			// Update capabilities
			this.capabilities.systemResources = systemResources;
			this.capabilities.lastUpdated = new Date();

			// Update broker with new capabilities
			await this.redisManager.hset(
				"workers",
				config.worker.id,
				JSON.stringify({
					workerId: config.worker.id,
					capabilities: this.capabilities,
					status: "online",
					lastUpdated: new Date().toISOString(),
				})
			);
		} catch (error) {
			logger.error("Failed to update capabilities", error);
		}
	}

	private shouldPauseWorker(resources: SystemResources): boolean {
		return (
			resources.cpuUsagePercent > config.performance.maxCpuUsage ||
			resources.memoryUsagePercent > config.performance.maxMemoryUsage ||
			resources.availableMemoryMB <
				config.performance.minAvailableMemoryMB ||
			(resources.gpuUsagePercent !== undefined &&
				resources.gpuUsagePercent >
					config.performance.maxGpuMemoryUsage)
		);
	}

	private async processInferenceJob(
		job: Job<InferenceRequest>
	): Promise<InferenceResponse> {
		const request = job.data;

		try {
			// Update job progress
			await job.updateProgress(10);

			// Validate model availability
			const isModelValid = await this.ollamaService.validateModel(
				request.model
			);
			if (!isModelValid) {
				throw new Error(`Model ${request.model} is not available`);
			}

			await job.updateProgress(25);

			// Check if this is an embedding request
			const isEmbeddingRequest =
				request.metadata?.requestType === "embedding";

			logger.info("Processing job assignment", {
				jobId: job.id,
				requestType: request.metadata?.requestType,
				isEmbeddingRequest,
				hasInput: !!request.input,
				hasPrompt: !!request.prompt,
				metadata: request.metadata,
			});

			// Process request based on type
			let result: InferenceResponse | undefined;

			if (isEmbeddingRequest) {
				logger.info("Handling as embedding request");
				// Handle embedding request
				result = await this.ollamaService.generateEmbedding(request);
			} else if (request.stream) {
				logger.info("Handling as streaming inference request");
				// For streaming inference, publish each chunk as it arrives
				let fullResponse = "";
				for await (const chunk of this.ollamaService.generateStreamResponse(
					request
				)) {
					fullResponse += chunk.response;
					await job.updateProgress(25 + (chunk.done ? 50 : 25));

					// Publish streaming chunk to the stream channel
					await this.redisManager.publish(
						`job:stream:${request.id}`,
						JSON.stringify({
							jobId: request.id,
							workerId: config.worker.id,
							chunk: {
								id: chunk.id,
								response: chunk.response,
								done: chunk.done,
							},
							timestamp: new Date().toISOString(),
						})
					);

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
				// Non-streaming inference
				result = await this.ollamaService.generateResponse(request);
			}

			if (!result) {
				throw new Error("No result generated from inference");
			}

			await job.updateProgress(100);

			// Notify broker of completion
			await this.redisManager.publish(
				"job:completed",
				JSON.stringify({
					jobId: job.id,
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

			return result;
		} catch (error) {
			// Notify broker of failure
			await this.redisManager.publish(
				"job:failed",
				JSON.stringify({
					jobId: job.id,
					workerId: config.worker.id,
					error:
						error instanceof Error
							? error.message
							: "Unknown error",
					timestamp: new Date().toISOString(),
				})
			);

			// Publish error to specific job channel for synchronous waiting
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

			throw error;
		}
	}

	private handleWorkerMessage(message: string): void {
		try {
			const data = JSON.parse(message);
			logger.debug("Received worker message", { type: data.type, data });

			switch (data.type) {
				case "pause":
					this.pauseWorker();
					break;
				case "resume":
					this.resumeWorker();
					break;
				case "shutdown":
					this.gracefulShutdown();
					break;
				case "update_capabilities":
					this.updateCapabilities();
					break;
				default:
					logger.warn("Unknown worker message type", {
						type: data.type,
					});
			}
		} catch (error) {
			logger.error("Failed to handle worker message", { message, error });
		}
	}

	private handleBroadcastMessage(message: string): void {
		try {
			const data = JSON.parse(message);
			logger.debug("Received broadcast message", { type: data.type });

			switch (data.type) {
				case "maintenance_mode":
					logger.info("Broker entering maintenance mode");
					this.emit("maintenance_mode", data);
					break;
				case "system_shutdown":
					logger.info("System shutdown initiated");
					this.gracefulShutdown();
					break;
				default:
					logger.debug("Unhandled broadcast message", {
						type: data.type,
					});
			}
		} catch (error) {
			logger.error("Failed to handle broadcast message", {
				message,
				error,
			});
		}
	}

	private handleSystemEvent(message: string): void {
		try {
			const event = JSON.parse(message);
			logger.info("System event received", { type: event.type });
			this.emit("system_event", event);
		} catch (error) {
			logger.error("Failed to handle system event", { message, error });
		}
	}

	private async pauseWorker(): Promise<void> {
		if (this.workQueueService) {
			await this.workQueueService.pause();
			logger.info("Worker paused");
		}
	}

	private async resumeWorker(): Promise<void> {
		if (this.workQueueService) {
			await this.workQueueService.resume();
			logger.info("Worker resumed");
		}
	}

	private async gracefulShutdown(): Promise<void> {
		logger.info("Initiating graceful shutdown");
		this.emit("shutdown_requested");

		setTimeout(() => {
			this.stop().catch((error) => {
				logger.error("Error during graceful shutdown", error);
				process.exit(1);
			});
		}, 5000); // 5 second delay for graceful shutdown
	}

	// Public methods
	async getStatus(): Promise<WorkerStatus | null> {
		if (!this.workQueueService) return null;
		return await this.workQueueService.getWorkerStatus();
	}

	getConnectionStatus(): BrokerConnection {
		const connectionStatus: BrokerConnection = {
			isConnected: this.isConnected,
			reconnectAttempts: this.reconnectAttempts,
		};

		if (this.isConnected) {
			connectionStatus.lastConnected = new Date();
		}

		return connectionStatus;
	}

	getCapabilities(): NodeCapabilities | null {
		return this.capabilities;
	}

	async addJob(request: InferenceRequest): Promise<void> {
		if (!this.workQueueService) {
			throw new Error("Work queue service not available");
		}

		await this.workQueueService.addJob(request);
	}

	async submitAndWait(request: InferenceRequest): Promise<InferenceResponse> {
		if (!this.workQueueService) {
			throw new Error("Work queue service not available");
		}

		const workQueue = this.workQueueService; // Store reference to avoid null check issues

		return new Promise(async (resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(
					new Error(
						`Inference request timed out after ${request.timeout}ms`
					)
				);
			}, request.timeout);

			try {
				// Subscribe to job completion events for this specific request
				const resultChannel = `job:result:${request.id}`;

				const handleResult = (message: string) => {
					try {
						const data = JSON.parse(message);

						if (data.jobId === request.id) {
							clearTimeout(timeout);
							this.redisManager.unsubscribe(resultChannel);

							if (data.error) {
								reject(new Error(data.error));
							} else {
								resolve(data.result);
							}
						}
					} catch (error) {
						logger.error("Failed to parse job result", error);
					}
				};

				// Subscribe to results before submitting the job
				await this.redisManager.subscribe(resultChannel, handleResult);

				// Submit the job to the network
				await workQueue.addJob(request);

				logger.info("Job submitted and waiting for result", {
					id: request.id,
					timeout: request.timeout,
				});
			} catch (error) {
				clearTimeout(timeout);
				reject(error);
			}
		});
	}
}

export default BrokerClientService;
