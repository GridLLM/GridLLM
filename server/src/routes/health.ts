import { Router, Request, Response } from "express";
import { WorkerRegistry } from "@/services/WorkerRegistry";
import { JobScheduler } from "@/services/JobScheduler";
import { RedisService } from "@/services/RedisService";
import { config } from "@/config";
import { asyncHandler } from "@/middleware/errorHandler";

export const healthRoutes = (
	workerRegistry: WorkerRegistry,
	jobScheduler: JobScheduler,
	redis: RedisService
): Router => {
	const router = Router();

	// Basic health check
	router.get(
		"/",
		asyncHandler(async (req: Request, res: Response) => {
			const status = {
				status: "ok",
				timestamp: new Date().toISOString(),
				uptime: process.uptime(),
				version: "1.0.0",
			};

			res.json(status);
		})
	);

	// Liveness probe
	router.get(
		"/live",
		asyncHandler(async (req: Request, res: Response) => {
			res.json({
				status: "alive",
				timestamp: new Date().toISOString(),
			});
		})
	);

	// Readiness probe
	router.get(
		"/ready",
		asyncHandler(async (req: Request, res: Response) => {
			const checks = {
				redis: false,
				workerRegistry: false,
				jobScheduler: false,
			};

			try {
				// Check Redis connection
				await redis.ping();
				checks.redis = true;
			} catch (error) {
				// Redis not ready
			}

			// Check worker registry
			checks.workerRegistry = workerRegistry.getWorkerCount() >= 0;

			// Check job scheduler
			checks.jobScheduler = jobScheduler.getActiveJobCount() >= 0;

			const allReady = Object.values(checks).every((check) => check);

			res.status(allReady ? 200 : 503).json({
				status: allReady ? "ready" : "not_ready",
				checks,
				timestamp: new Date().toISOString(),
			});
		})
	);

	// Detailed system information
	router.get(
		"/system",
		asyncHandler(async (req: Request, res: Response) => {
			const systemInfo = {
				server: {
					id: config.server.id,
					version: "1.0.0",
					environment: config.env,
					uptime: process.uptime(),
					timestamp: new Date().toISOString(),
				},
				workers: {
					total: workerRegistry.getWorkerCount(),
					online: workerRegistry.getOnlineWorkerCount(),
					available: workerRegistry.getAvailableWorkerCount(),
					models: workerRegistry.getAllAvailableModels(),
				},
				jobs: {
					active: jobScheduler.getActiveJobCount(),
					queued: jobScheduler.getQueuedJobCount(),
				},
				resources: {
					memory: {
						used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
						total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
						external: Math.round(process.memoryUsage().external / 1024 / 1024),
					},
					cpu: {
						usage: process.cpuUsage(),
					},
				},
			};

			res.json(systemInfo);
		})
	);

	// Worker details
	router.get(
		"/workers",
		asyncHandler(async (req: Request, res: Response) => {
			const workers = workerRegistry.getAllWorkers().map((worker) => ({
				id: worker.workerId,
				status: worker.status,
				currentJobs: worker.currentJobs,
				totalJobsProcessed: worker.totalJobsProcessed,
				performanceTier: worker.capabilities.performanceTier,
				models: worker.capabilities.availableModels.length,
				lastHeartbeat: worker.lastHeartbeat,
				connectionHealth: worker.connectionHealth,
			}));

			res.json({
				workers,
				count: workers.length,
				summary: {
					online: workers.filter((w) => w.status === "online").length,
					busy: workers.filter((w) => w.status === "busy").length,
					offline: workers.filter((w) => w.status === "offline").length,
					error: workers.filter((w) => w.status === "error").length,
				},
			});
		})
	);

	// Job statistics
	router.get(
		"/jobs",
		asyncHandler(async (req: Request, res: Response) => {
			const activeJobs = jobScheduler.getActiveJobs();
			const queuedJobs = jobScheduler.getJobQueue();

			res.json({
				active: {
					count: activeJobs.length,
					jobs: activeJobs.map((job) => ({
						id: job.jobId,
						workerId: job.workerId,
						model: job.request.model,
						assignedAt: job.assignedAt,
						timeout: job.timeout,
					})),
				},
				queued: {
					count: queuedJobs.length,
					jobs: queuedJobs.map((job) => ({
						id: job.id,
						model: job.model,
						priority: job.priority,
					})),
				},
			});
		})
	);

	return router;
};
