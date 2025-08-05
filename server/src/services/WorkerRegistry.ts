import { EventEmitter } from "events";
import { RedisService } from "./RedisService";
import { WorkerInfo, NodeCapabilities, WorkerStatus } from "@/types";
import { config } from "@/config";
import { logger } from "@/utils/logger";

export class WorkerRegistry extends EventEmitter {
	private redis: RedisService;
	private workers: Map<string, WorkerInfo> = new Map();
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor() {
		super();
		this.redis = RedisService.getInstance();
	}

	async initialize(): Promise<void> {
		try {
			logger.info("Initializing worker registry");

			// Subscribe to worker events
			await this.redis.subscribe(
				"worker:registered",
				this.handleWorkerRegistered.bind(this)
			);
			await this.redis.subscribe(
				"worker:unregistered",
				this.handleWorkerUnregistered.bind(this)
			);
			await this.redis.subscribe(
				"worker:heartbeat",
				this.handleWorkerHeartbeat.bind(this)
			);
			await this.redis.subscribe(
				"worker:status_update",
				this.handleWorkerStatusUpdate.bind(this)
			);

			// Subscribe to Redis disconnection events
			await this.redis.subscribe(
				"worker:disconnected",
				this.handleWorkerDisconnected.bind(this)
			);
			// Load existing workers from Redis
			await this.loadExistingWorkers();

			// Start cleanup interval
			this.startCleanupInterval();

			logger.info("Worker registry initialized successfully");
		} catch (error) {
			logger.error("Failed to initialize worker registry", error);
			throw error;
		}
	}

	async stop(): Promise<void> {
		logger.info("Stopping worker registry");

		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		// Unsubscribe from events
		await this.redis.unsubscribe("worker:registered");
		await this.redis.unsubscribe("worker:unregistered");
		await this.redis.unsubscribe("worker:heartbeat");
		await this.redis.unsubscribe("worker:status_update");
		await this.redis.unsubscribe("worker:disconnected");

		this.workers.clear();
		logger.info("Worker registry stopped");
	}

	private async loadExistingWorkers(): Promise<void> {
		try {
			const workerData = await this.redis.hgetall("workers");

			for (const [workerId, data] of Object.entries(workerData)) {
				try {
					const workerInfo = JSON.parse(data) as WorkerInfo;

					// Check if worker is still alive based on last heartbeat
					const heartbeatAge =
						Date.now() - new Date(workerInfo.lastHeartbeat).getTime();

					if (heartbeatAge < config.server.workerHeartbeatTimeout) {
						workerInfo.status = "online";
						this.workers.set(workerId, workerInfo);
						logger.worker(workerId, "Loaded existing worker");
					} else {
						// Worker is stale, remove it
						await this.removeWorker(workerId);
						logger.worker(
							workerId,
							"Removed stale worker during initialization"
						);
					}
				} catch (error) {
					logger.error(`Failed to parse worker data for ${workerId}`, error);
					await this.redis.hdel("workers", workerId);
				}
			}

			logger.info(`Loaded ${this.workers.size} existing workers`);
		} catch (error) {
			logger.error("Failed to load existing workers", error);
		}
	}

	private startCleanupInterval(): void {
		this.cleanupInterval = setInterval(async () => {
			await this.cleanupStaleWorkers();
		}, config.server.workerCleanupInterval);

		logger.info("Worker cleanup interval started", {
			interval: config.server.workerCleanupInterval,
		});

		// Also start immediate connection monitoring
		this.startConnectionMonitoring();
	}

	private startConnectionMonitoring(): void {
		// Monitor Redis client connections more frequently for immediate disconnection detection
		setInterval(async () => {
			await this.checkWorkerConnections();
		}, 5000); // Check every 5 seconds for immediate detection

		logger.info("Worker connection monitoring started");
	}

	private async checkWorkerConnections(): Promise<void> {
		const now = Date.now();
		const quickDisconnectThreshold = 15000; // 15 seconds for immediate disconnection detection

		for (const [workerId, worker] of this.workers.entries()) {
			const lastSeen = new Date(worker.lastHeartbeat).getTime();
			const timeSinceLastSeen = now - lastSeen;

			// If worker hasn't been seen for 15 seconds, check if it's really gone
			if (
				timeSinceLastSeen > quickDisconnectThreshold &&
				timeSinceLastSeen < config.server.workerHeartbeatTimeout
			) {
				logger.debug(
					`Checking worker ${workerId} aliveness - ${timeSinceLastSeen}ms since last heartbeat`
				);
				const isStillConnected = await this.checkWorkerAliveness(workerId);
				if (!isStillConnected) {
					logger.warn(
						`Worker ${workerId} appears to have disconnected abruptly (${worker.currentJobs} active jobs) - removing immediately`
					);
					await this.removeWorker(workerId);
				}
			}
		}
	}

	private async checkWorkerAliveness(workerId: string): Promise<boolean> {
		try {
			// Try to get the worker's heartbeat record from Redis
			const heartbeatKey = `heartbeat:${workerId}`;
			const heartbeatData = await this.redis.get(heartbeatKey);

			if (!heartbeatData) {
				return false; // No heartbeat data means worker is likely disconnected
			}

			const heartbeat = JSON.parse(heartbeatData);
			const heartbeatAge = Date.now() - new Date(heartbeat.timestamp).getTime();

			// If heartbeat is older than 15 seconds, worker is likely disconnected
			return heartbeatAge < 15000;
		} catch (error) {
			logger.error(`Failed to check worker ${workerId} aliveness`, error);
			return false; // Assume disconnected on error
		}
	}

	private async cleanupStaleWorkers(): Promise<void> {
		const now = Date.now();
		const staleWorkers: string[] = [];

		for (const [workerId, worker] of this.workers.entries()) {
			const lastSeen = new Date(worker.lastHeartbeat).getTime();
			const timeSinceLastSeen = now - lastSeen;

			if (timeSinceLastSeen > config.server.workerHeartbeatTimeout) {
				staleWorkers.push(workerId);
			}
		}

		if (staleWorkers.length > 0) {
			logger.warn(
				`Cleaning up ${staleWorkers.length} stale workers and redistributing their tasks`
			);

			for (const workerId of staleWorkers) {
				// Get worker info before removing it to check for active jobs
				const worker = this.workers.get(workerId);

				if (worker && worker.currentJobs > 0) {
					logger.warn(
						`Stale worker ${workerId} had ${worker.currentJobs} active jobs - redistributing to queue`
					);
				}

				await this.removeWorker(workerId);
				logger.warn(`Removed stale worker: ${workerId}`);
			}
		} else {
			// Add periodic debug logging to show the cleanup is running
			logger.debug(
				`Worker cleanup cycle complete - ${this.workers.size} workers online`
			);
		}
	}

	private async handleWorkerRegistered(message: string): Promise<void> {
		try {
			const data = JSON.parse(message);
			const workerInfo: WorkerInfo = {
				workerId: data.workerId,
				capabilities: data.capabilities,
				status: "online",
				currentJobs: 0,
				lastHeartbeat: new Date(),
				registeredAt: new Date(data.registeredAt),
				totalJobsProcessed: 0,
				connectionHealth: "healthy",
			};

			this.workers.set(data.workerId, workerInfo);

			// Store in Redis
			await this.redis.hset(
				"workers",
				data.workerId,
				JSON.stringify(workerInfo)
			);

			this.emit("worker_registered", workerInfo);
			logger.worker(data.workerId, "Worker registered");
		} catch (error) {
			logger.error("Failed to handle worker registration", error);
		}
	}

	private async handleWorkerUnregistered(message: string): Promise<void> {
		try {
			const data = JSON.parse(message);
			await this.removeWorker(data.workerId);
			logger.worker(data.workerId, "Worker unregistered");
		} catch (error) {
			logger.error("Failed to handle worker unregistration", error);
		}
	}

	private async handleWorkerHeartbeat(message: string): Promise<void> {
		try {
			const data = JSON.parse(message);
			const worker = this.workers.get(data.workerId);

			if (worker) {
				worker.lastHeartbeat = new Date(data.timestamp);
				worker.status = data.status || "online";
				worker.currentJobs = data.currentJobs || 0;
				worker.connectionHealth = data.connectionHealth || "healthy";

				// Update in Redis
				await this.redis.hset("workers", data.workerId, JSON.stringify(worker));

				this.emit("worker_heartbeat", worker);
			} else {
				// Worker not in memory, check if it exists in Redis
				const workerData = await this.redis.hget("workers", data.workerId);

				if (workerData) {
					// Worker exists in Redis but not in memory, load it
					try {
						const workerInfo = JSON.parse(workerData) as WorkerInfo;
						workerInfo.lastHeartbeat = new Date(data.timestamp);
						workerInfo.status = data.status || "online";
						workerInfo.currentJobs = data.currentJobs || 0;
						workerInfo.connectionHealth = data.connectionHealth || "healthy";

						this.workers.set(data.workerId, workerInfo);

						// Update in Redis with fresh heartbeat
						await this.redis.hset(
							"workers",
							data.workerId,
							JSON.stringify(workerInfo)
						);

						this.emit("worker_heartbeat", workerInfo);
						logger.worker(
							data.workerId,
							"Re-loaded worker from Redis on heartbeat"
						);
					} catch (parseError) {
						logger.error(
							`Failed to parse worker data from Redis for ${data.workerId}`,
							parseError
						);
						// Send re-registration request
						await this.requestWorkerReregistration(data.workerId);
					}
				} else {
					// Worker not in Redis either, request re-registration
					logger.worker(
						data.workerId,
						"Received heartbeat from unknown worker, requesting re-registration"
					);
					await this.requestWorkerReregistration(data.workerId);
				}
			}
		} catch (error) {
			logger.error("Failed to handle worker heartbeat", error);
		}
	}

	private async handleWorkerStatusUpdate(message: string): Promise<void> {
		try {
			const data = JSON.parse(message);
			const worker = this.workers.get(data.workerId);

			if (worker) {
				worker.status = data.status;
				worker.currentJobs = data.currentJobs || worker.currentJobs;

				if (data.systemResources) {
					worker.capabilities.systemResources = data.systemResources;
					worker.capabilities.lastUpdated = new Date();
				}

				// Update in Redis
				await this.redis.hset("workers", data.workerId, JSON.stringify(worker));

				this.emit("worker_status_changed", worker);
				logger.worker(data.workerId, "Worker status updated", {
					status: data.status,
				});
			}
		} catch (error) {
			logger.error("Failed to handle worker status update", error);
		}
	}

	private async handleWorkerDisconnected(message: string): Promise<void> {
		try {
			const data = JSON.parse(message);
			const worker = this.workers.get(data.workerId);

			if (worker) {
				logger.warn(
					`Worker ${data.workerId} disconnected abruptly (${worker.currentJobs} active jobs) - redistributing tasks`
				);
			} else {
				logger.warn(`Worker ${data.workerId} disconnected abruptly`);
			}

			await this.removeWorker(data.workerId);
		} catch (error) {
			logger.error("Failed to handle worker disconnection", error);
		}
	}

	private async removeWorker(workerId: string): Promise<void> {
		const worker = this.workers.get(workerId);

		if (worker) {
			this.workers.delete(workerId);
			await this.redis.hdel("workers", workerId);

			this.emit("worker_removed", worker);
		}
	}

	// Public methods
	getWorker(workerId: string): WorkerInfo | undefined {
		return this.workers.get(workerId);
	}

	getAllWorkers(): WorkerInfo[] {
		return Array.from(this.workers.values());
	}

	getOnlineWorkers(): WorkerInfo[] {
		return this.getAllWorkers().filter(
			(worker) => worker.status === "online" || worker.status === "busy"
		);
	}

	getAvailableWorkers(): WorkerInfo[] {
		return this.getAllWorkers().filter(
			(worker) =>
				worker.status === "online" &&
				worker.currentJobs < config.jobs.maxConcurrentJobsPerWorker
		);
	}

	getWorkersByModel(modelName: string): WorkerInfo[] {
		return this.getAllWorkers().filter((worker) =>
			worker.capabilities.availableModels.some(
				(model) => model.name === modelName
			)
		);
	}

	getAvailableWorkersByModel(modelName: string): WorkerInfo[] {
		return this.getAvailableWorkers().filter((worker) =>
			worker.capabilities.availableModels.some(
				(model) => model.name === modelName
			)
		);
	}

	async updateWorkerJobCount(
		workerId: string,
		increment: number
	): Promise<void> {
		const worker = this.workers.get(workerId);

		if (worker) {
			worker.currentJobs = Math.max(0, worker.currentJobs + increment);

			// Update status based on job count
			if (worker.currentJobs >= config.jobs.maxConcurrentJobsPerWorker) {
				worker.status = "busy";
			} else if (
				worker.status === "busy" &&
				worker.currentJobs < config.jobs.maxConcurrentJobsPerWorker
			) {
				worker.status = "online";
			}

			// Update total jobs processed if job completed
			if (increment < 0) {
				worker.totalJobsProcessed++;
			}

			// Update in Redis
			await this.redis.hset("workers", workerId, JSON.stringify(worker));

			this.emit("worker_job_count_changed", worker);
			logger.worker(workerId, "Job count updated", {
				currentJobs: worker.currentJobs,
				status: worker.status,
			});
		}
	}

	async markWorkerBusy(workerId: string): Promise<void> {
		await this.updateWorkerJobCount(workerId, 1);
	}

	async markWorkerAvailable(workerId: string): Promise<void> {
		await this.updateWorkerJobCount(workerId, -1);
	}

	getWorkerCount(): number {
		return this.workers.size;
	}

	getOnlineWorkerCount(): number {
		return this.getOnlineWorkers().length;
	}

	getAvailableWorkerCount(): number {
		return this.getAvailableWorkers().length;
	}

	getTotalActiveJobs(): number {
		return this.getAllWorkers().reduce(
			(total, worker) => total + worker.currentJobs,
			0
		);
	}

	// Get all available models across all workers
	getAllAvailableModels(): string[] {
		const models = new Set<string>();

		for (const worker of this.getOnlineWorkers()) {
			for (const model of worker.capabilities.availableModels) {
				models.add(model.name);
			}
		}

		return Array.from(models);
	}

	private async requestWorkerReregistration(workerId: string): Promise<void> {
		try {
			// Send a re-registration request to the worker
			await this.redis.publish(
				`worker:reregister:${workerId}`,
				JSON.stringify({
					workerId,
					timestamp: new Date().toISOString(),
					reason: "unknown_worker_heartbeat",
				})
			);

			logger.worker(workerId, "Sent re-registration request to worker");
		} catch (error) {
			logger.error(
				`Failed to send re-registration request to worker ${workerId}`,
				error
			);
		}
	}
}
