import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { config } from "@/config";
import { logger } from "@/utils/logger";
import { RedisConnectionManager } from "./RedisConnectionManager";
import {
	InferenceRequest,
	InferenceResponse,
	TaskJob,
	NodeCapabilities,
	WorkerStatus,
} from "@/types";

export interface WorkQueueOptions {
	concurrency?: number;
	attempts?: number;
	backoff?: {
		type: "exponential" | "fixed";
		delay: number;
	};
}

export class WorkQueueService {
	private taskQueue: Queue;
	private worker: Worker;
	private queueEvents: QueueEvents;
	private redisManager: RedisConnectionManager;
	private isRunning: boolean = false;
	private processedJobs: number = 0;
	private failedJobs: number = 0;

	constructor(
		private workerId: string,
		private capabilities: NodeCapabilities,
		private onProcessJob: (
			job: Job<InferenceRequest>
		) => Promise<InferenceResponse>
	) {
		this.redisManager = RedisConnectionManager.getInstance();

		const connection = {
			host: config.redis.host,
			port: config.redis.port,
			password: config.redis.password,
			db: config.redis.db,
		};

		// Initialize queue
		this.taskQueue = new Queue("inference-tasks", {
			connection,
			defaultJobOptions: {
				attempts: config.tasks.retryAttempts,
				backoff: {
					type: "exponential",
					delay: config.tasks.retryDelay,
				},
				removeOnComplete: 100, // Keep last 100 completed jobs
				removeOnFail: 50, // Keep last 50 failed jobs
			},
		});

		// Initialize worker
		this.worker = new Worker("inference-tasks", this.processTask.bind(this), {
			connection,
			concurrency: config.worker.concurrency,
			maxStalledCount: 1,
			stalledInterval: 30000,
		});

		// Initialize queue events
		this.queueEvents = new QueueEvents("inference-tasks", { connection });

		this.setupEventHandlers();
	}

	private setupEventHandlers(): void {
		// Worker events
		this.worker.on("completed", (job: Job, result: InferenceResponse) => {
			this.processedJobs++;
			logger.info("Job completed", {
				jobId: job.id,
				workerId: this.workerId,
				result: {
					id: result.id,
					responseLength: result.response?.length || 0,
					duration: result.total_duration,
				},
			});
		});

		this.worker.on("failed", (job: Job | undefined, error: Error) => {
			this.failedJobs++;
			logger.error("Job failed", {
				jobId: job?.id,
				workerId: this.workerId,
				error: error.message,
				attempts: job?.attemptsMade,
			});
		});

		this.worker.on("error", (error: Error) => {
			logger.error("Worker error", {
				workerId: this.workerId,
				error: error.message,
			});
		});

		this.worker.on("stalled", (jobId: string) => {
			logger.warn("Job stalled", {
				jobId,
				workerId: this.workerId,
			});
		});

		// Queue events
		this.queueEvents.on("waiting", ({ jobId }: { jobId: string }) => {
			logger.debug("Job waiting", { jobId });
		});

		this.queueEvents.on("active", ({ jobId }: { jobId: string }) => {
			logger.debug("Job active", { jobId, workerId: this.workerId });
		});

		this.queueEvents.on(
			"progress",
			({ jobId, data }: { jobId: string; data: any }) => {
				logger.debug("Job progress", { jobId, progress: data });
			}
		);
	}

	private async processTask(
		job: Job<InferenceRequest>
	): Promise<InferenceResponse> {
		const request = job.data;

		logger.info("Processing inference task", {
			jobId: job.id,
			workerId: this.workerId,
			model: request.model,
			priority: request.priority,
		});

		try {
			// Update job progress
			await job.updateProgress(10);

			// Validate that we can handle this model
			const canHandle = this.capabilities.availableModels.some(
				(model) => model.name === request.model
			);

			if (!canHandle) {
				throw new Error(`Model ${request.model} not available on this worker`);
			}

			await job.updateProgress(25);

			// Process the inference request
			const result = await this.onProcessJob(job);

			await job.updateProgress(100);

			logger.info("Inference task completed", {
				jobId: job.id,
				workerId: this.workerId,
				duration: result.total_duration,
			});

			return result;
		} catch (error) {
			logger.error("Inference task failed", {
				jobId: job.id,
				workerId: this.workerId,
				error: error instanceof Error ? error.message : "Unknown error",
			});
			throw error;
		}
	}

	async start(): Promise<void> {
		try {
			logger.info("Starting work queue service", {
				workerId: this.workerId,
				concurrency: config.worker.concurrency,
			});

			this.isRunning = true;

			// Register worker with broker
			await this.registerWorker();

			logger.info("Work queue service started successfully");
		} catch (error) {
			logger.error("Failed to start work queue service", error);
			throw error;
		}
	}

	async stop(): Promise<void> {
		try {
			logger.info("Stopping work queue service", {
				workerId: this.workerId,
			});

			this.isRunning = false;

			// Graceful shutdown
			await this.worker.close();
			await this.queueEvents.close();
			await this.taskQueue.close();

			// Unregister worker
			await this.unregisterWorker();

			logger.info("Work queue service stopped successfully");
		} catch (error) {
			logger.error("Error stopping work queue service", error);
			throw error;
		}
	}

	async addJob(
		request: InferenceRequest,
		options: WorkQueueOptions = {}
	): Promise<Job<InferenceRequest>> {
		try {
			const priority = this.getPriorityWeight(request.priority);

			const job = await this.taskQueue.add("inference", request, {
				priority,
				attempts: options.attempts || config.tasks.retryAttempts,
				backoff: options.backoff || {
					type: "exponential",
					delay: config.tasks.retryDelay,
				},
				delay: 0,
				jobId: request.id,
			});

			logger.info("Job added to queue", {
				jobId: job.id,
				priority: request.priority,
				model: request.model,
			});

			return job;
		} catch (error) {
			logger.error("Failed to add job to queue", {
				requestId: request.id,
				error: error instanceof Error ? error.message : "Unknown error",
			});
			throw error;
		}
	}

	async getJob(jobId: string): Promise<Job<InferenceRequest> | undefined> {
		return await this.taskQueue.getJob(jobId);
	}

	async removeJob(jobId: string): Promise<void> {
		const job = await this.getJob(jobId);
		if (job) {
			await job.remove();
			logger.info("Job removed from queue", { jobId });
		}
	}

	async getQueueStatus(): Promise<{
		waiting: number;
		active: number;
		completed: number;
		failed: number;
		delayed: number;
	}> {
		const counts = await this.taskQueue.getJobCounts(
			"waiting",
			"active",
			"completed",
			"failed",
			"delayed"
		);

		return {
			waiting: counts.waiting || 0,
			active: counts.active || 0,
			completed: counts.completed || 0,
			failed: counts.failed || 0,
			delayed: counts.delayed || 0,
		};
	}

	async getWorkerStatus(): Promise<WorkerStatus> {
		const jobCounts = await this.getQueueStatus();
		const activeJobs = await this.taskQueue.getActive();

		return {
			id: this.workerId,
			status: this.isRunning
				? activeJobs.length > 0
					? "busy"
					: "online"
				: "offline",
			currentJobs: activeJobs.map((job: Job) => job.id || ""),
			capabilities: this.capabilities,
			lastHeartbeat: new Date(),
			connectionHealth: this.redisManager.getConnectionStatus().isConnected
				? "healthy"
				: "poor",
		};
	}

	private async registerWorker(): Promise<void> {
		try {
			const workerData = {
				id: this.workerId,
				capabilities: this.capabilities,
				status: "online",
				registeredAt: new Date().toISOString(),
				lastHeartbeat: new Date().toISOString(),
			};

			await this.redisManager.hset(
				"workers",
				this.workerId,
				JSON.stringify(workerData)
			);

			await this.redisManager.publish(
				"worker:registered",
				JSON.stringify(workerData)
			);

			logger.info("Worker registered with broker", {
				workerId: this.workerId,
			});
		} catch (error) {
			logger.error("Failed to register worker", {
				workerId: this.workerId,
				error: error instanceof Error ? error.message : "Unknown error",
			});
			throw error;
		}
	}

	private async unregisterWorker(): Promise<void> {
		try {
			await this.redisManager.delete(`workers:${this.workerId}`);

			await this.redisManager.publish(
				"worker:unregistered",
				JSON.stringify({
					id: this.workerId,
					timestamp: new Date().toISOString(),
				})
			);

			logger.info("Worker unregistered from broker", {
				workerId: this.workerId,
			});
		} catch (error) {
			logger.error("Failed to unregister worker", {
				workerId: this.workerId,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	private getPriorityWeight(priority: "high" | "medium" | "low"): number {
		return config.tasks.priorityWeights[priority] || 1;
	}

	getStats(): {
		processedJobs: number;
		failedJobs: number;
		isRunning: boolean;
		workerId: string;
	} {
		return {
			processedJobs: this.processedJobs,
			failedJobs: this.failedJobs,
			isRunning: this.isRunning,
			workerId: this.workerId,
		};
	}

	async pause(): Promise<void> {
		await this.worker.pause();
		logger.info("Worker paused", { workerId: this.workerId });
	}

	async resume(): Promise<void> {
		await this.worker.resume();
		logger.info("Worker resumed", { workerId: this.workerId });
	}

	async clean(grace: number = 5000): Promise<string[]> {
		const jobs = await this.taskQueue.clean(grace, 100, "completed");
		logger.info("Cleaned completed jobs", {
			workerId: this.workerId,
			cleanedCount: jobs.length,
		});
		return jobs;
	}
}

export default WorkQueueService;
