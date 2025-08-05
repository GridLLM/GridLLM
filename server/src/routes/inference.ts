import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import Joi from "joi";
import { JobScheduler } from "@/services/JobScheduler";
import { WorkerRegistry } from "@/services/WorkerRegistry";
import { logger } from "@/utils/logger";
import { asyncHandler, createError } from "@/middleware/errorHandler";
import { InferenceRequest } from "@/types";

export const inferenceRoutes = (
	jobScheduler: JobScheduler,
	workerRegistry: WorkerRegistry
): Router => {
	const router = Router();

	// Validation schema for inference requests
	const inferenceRequestSchema = Joi.object({
		model: Joi.string().required(),
		prompt: Joi.string().required().max(100000), // 100KB max prompt
		stream: Joi.boolean().default(false),
		options: Joi.object({
			temperature: Joi.number().min(0).max(2).default(0.8),
			top_k: Joi.number().integer().min(1).max(100).default(40),
			top_p: Joi.number().min(0).max(1).default(0.9),
			num_predict: Joi.number().integer().min(-1).max(4096).default(128),
			stop: Joi.array().items(Joi.string()).max(10),
			seed: Joi.number().integer(),
		}).default({}),
		priority: Joi.string().valid("high", "medium", "low").default("medium"),
		timeout: Joi.number().integer().min(1000).max(600000).default(300000), // 5 minutes default
		metadata: Joi.object().default({}),
	});

	// Submit inference request
	router.post(
		"/",
		asyncHandler(async (req: Request, res: Response) => {
			// Validate request body
			const { error, value: validatedData } = inferenceRequestSchema.validate(
				req.body
			);
			if (error) {
				throw createError(
					`Validation error: ${error.details[0]?.message}`,
					400
				);
			}

			// Check if model is available across the worker network
			const availableModels = workerRegistry.getAllAvailableModels();
			if (!availableModels.includes(validatedData.model)) {
				throw createError(
					`Model '${validatedData.model}' is not available on any worker`,
					400
				);
			}

			// Check if there are available workers for this model
			const availableWorkers = workerRegistry.getAvailableWorkersByModel(
				validatedData.model
			);
			if (availableWorkers.length === 0) {
				throw createError(
					`No available workers for model '${validatedData.model}'`,
					503
				);
			}

			// Create inference request
			const inferenceRequest: InferenceRequest = {
				id: uuidv4(),
				model: validatedData.model,
				prompt: validatedData.prompt,
				stream: validatedData.stream,
				options: validatedData.options,
				priority: validatedData.priority,
				timeout: validatedData.timeout,
				metadata: {
					...validatedData.metadata,
					submittedAt: new Date().toISOString(),
					clientIp: req.ip,
					userAgent: req.get("User-Agent"),
				},
			};

			logger.job(inferenceRequest.id, "Inference request submitted", {
				model: inferenceRequest.model,
				priority: inferenceRequest.priority,
				promptLength: inferenceRequest.prompt?.length || 0,
				availableWorkers: availableWorkers.length,
			});

			try {
				// Submit job and wait for completion
				const result = await jobScheduler.submitAndWait(inferenceRequest);

				// Return the actual response from worker
				res.status(200).json({
					id: inferenceRequest.id,
					model: result.model,
					created_at: result.created_at,
					response: result.response,
					done: result.done,
					context: result.context,
					total_duration: result.total_duration,
					load_duration: result.load_duration,
					prompt_eval_count: result.prompt_eval_count,
					prompt_eval_duration: result.prompt_eval_duration,
					eval_count: result.eval_count,
					eval_duration: result.eval_duration,
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				logger.job(inferenceRequest.id, "Inference request failed", {
					error: error instanceof Error ? error.message : "Unknown error",
				});

				if (error instanceof Error) {
					throw createError(error.message, 500);
				} else {
					throw createError("Unknown error occurred", 500);
				}
			}
		})
	);

	// Get inference status
	router.get(
		"/:id/status",
		asyncHandler(async (req: Request, res: Response) => {
			const { id } = req.params;

			// Check if job is in queue
			const queuedJobs = jobScheduler.getJobQueue();
			const queuedJob = queuedJobs.find((job) => job.id === id);

			if (queuedJob) {
				res.json({
					id,
					status: "queued",
					position: queuedJobs.indexOf(queuedJob) + 1,
					priority: queuedJob.priority,
					timestamp: new Date().toISOString(),
				});
				return;
			}

			// Check if job is active
			const activeJobs = jobScheduler.getActiveJobs();
			const activeJob = activeJobs.find((job) => job.jobId === id);

			if (activeJob) {
				res.json({
					id,
					status: "processing",
					workerId: activeJob.workerId,
					assignedAt: activeJob.assignedAt,
					timeout: activeJob.timeout,
					timestamp: new Date().toISOString(),
				});
				return;
			}

			// Job not found
			throw createError("Job not found", 404);
		})
	);

	// Cancel inference request
	router.delete(
		"/:id",
		asyncHandler(async (req: Request, res: Response) => {
			const { id } = req.params;

			if (!id) {
				throw createError("Job ID is required", 400);
			}

			const cancelled = await jobScheduler.cancelJob(id);

			if (cancelled) {
				logger.job(id, "Inference request cancelled");
				res.json({
					id,
					status: "cancelled",
					timestamp: new Date().toISOString(),
				});
			} else {
				throw createError("Job not found or cannot be cancelled", 404);
			}
		})
	);

	// Get available models across all workers
	router.get(
		"/models",
		asyncHandler(async (req: Request, res: Response) => {
			const models = new Map<
				string,
				{
					name: string;
					workers: number;
					availableWorkers: number;
					totalSize?: number;
				}
			>();

			// Aggregate model information from all workers
			const allWorkers = workerRegistry.getAllWorkers();

			for (const worker of allWorkers) {
				for (const model of worker.capabilities.availableModels) {
					const existing = models.get(model.name);

					if (existing) {
						existing.workers++;
						if (
							worker.status === "online" &&
							worker.currentJobs < worker.capabilities.maxConcurrentTasks
						) {
							existing.availableWorkers++;
						}
					} else {
						models.set(model.name, {
							name: model.name,
							workers: 1,
							availableWorkers:
								worker.status === "online" &&
								worker.currentJobs < worker.capabilities.maxConcurrentTasks
									? 1
									: 0,
							totalSize: model.size,
						});
					}
				}
			}

			const modelList = Array.from(models.values()).sort((a, b) =>
				a.name.localeCompare(b.name)
			);

			res.json({
				models: modelList,
				count: modelList.length,
				totalWorkers: allWorkers.length,
				onlineWorkers: workerRegistry.getOnlineWorkerCount(),
				timestamp: new Date().toISOString(),
			});
		})
	);

	// Get queue statistics
	router.get(
		"/queue",
		asyncHandler(async (req: Request, res: Response) => {
			const queuedJobs = jobScheduler.getJobQueue();
			const activeJobs = jobScheduler.getActiveJobs();

			res.json({
				queue: {
					count: queuedJobs.length,
					jobs: queuedJobs.map((job, index) => ({
						id: job.id,
						model: job.model,
						priority: job.priority,
						position: index + 1,
					})),
				},
				active: {
					count: activeJobs.length,
					jobs: activeJobs.map((job) => ({
						id: job.jobId,
						model: job.request.model,
						workerId: job.workerId,
						assignedAt: job.assignedAt,
					})),
				},
				workers: {
					total: workerRegistry.getWorkerCount(),
					online: workerRegistry.getOnlineWorkerCount(),
					available: workerRegistry.getAvailableWorkerCount(),
				},
				timestamp: new Date().toISOString(),
			});
		})
	);

	return router;
};
