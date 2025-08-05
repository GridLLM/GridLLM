import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import Joi from "joi";
import { JobScheduler } from "@/services/JobScheduler";
import { WorkerRegistry } from "@/services/WorkerRegistry";
import { InferenceRequest, OllamaModel } from "@/types";
import { logger } from "@/utils/logger";
import { asyncHandler, createError } from "@/middleware/errorHandler";

export const ollamaRoutes = (
	jobScheduler: JobScheduler,
	workerRegistry: WorkerRegistry
): Router => {
	const router = Router();

	// Validation schemas for different endpoints
	const generateRequestSchema = Joi.object({
		model: Joi.string().required(),
		prompt: Joi.string().required().max(100000),
		suffix: Joi.string().optional(),
		images: Joi.array().items(Joi.string()).optional(),
		think: Joi.boolean().optional(),
		format: Joi.alternatives()
			.try(Joi.string().valid("json"), Joi.object())
			.optional(),
		options: Joi.object({
			temperature: Joi.number().min(0).max(2),
			top_k: Joi.number().integer().min(1).max(100),
			top_p: Joi.number().min(0).max(1),
			min_p: Joi.number().min(0).max(1),
			typical_p: Joi.number().min(0).max(1),
			repeat_last_n: Joi.number().integer().min(-1),
			repeat_penalty: Joi.number().min(0),
			presence_penalty: Joi.number(),
			frequency_penalty: Joi.number(),
			penalize_newline: Joi.boolean(),
			stop: Joi.array().items(Joi.string()).max(10),
			numa: Joi.boolean(),
			num_ctx: Joi.number().integer().min(1),
			num_batch: Joi.number().integer().min(1),
			num_gpu: Joi.number().integer().min(0),
			main_gpu: Joi.number().integer().min(0),
			use_mmap: Joi.boolean(),
			num_thread: Joi.number().integer().min(1),
			num_keep: Joi.number().integer().min(0),
			seed: Joi.number().integer(),
			num_predict: Joi.number().integer().min(-1),
		}).optional(),
		system: Joi.string().optional(),
		template: Joi.string().optional(),
		stream: Joi.boolean().default(true),
		raw: Joi.boolean().default(false),
		keep_alive: Joi.alternatives()
			.try(Joi.string(), Joi.number().integer().min(0))
			.optional(),
		context: Joi.array().items(Joi.number()).optional(),
	});

	const chatRequestSchema = Joi.object({
		model: Joi.string().required(),
		messages: Joi.array()
			.items(
				Joi.object({
					role: Joi.string()
						.valid("system", "user", "assistant", "tool")
						.required(),
					content: Joi.string().required(),
					thinking: Joi.string().optional(),
					images: Joi.array().items(Joi.string()).optional(),
					tool_calls: Joi.array().items(Joi.object()).optional(),
					tool_name: Joi.string().optional(),
				})
			)
			.required(),
		tools: Joi.array()
			.items(
				Joi.object({
					type: Joi.string().valid("function").required(),
					function: Joi.object({
						name: Joi.string().required(),
						description: Joi.string().required(),
						parameters: Joi.object().required(),
					}).required(),
				})
			)
			.optional(),
		think: Joi.boolean().optional(),
		format: Joi.alternatives()
			.try(Joi.string().valid("json"), Joi.object())
			.optional(),
		options: Joi.object().optional(),
		stream: Joi.boolean().default(true),
		keep_alive: Joi.alternatives()
			.try(Joi.string(), Joi.number().integer().min(0))
			.optional(),
	});

	const embedRequestSchema = Joi.object({
		model: Joi.string().required(),
		input: Joi.alternatives()
			.try(Joi.string(), Joi.array().items(Joi.string()))
			.required(),
		truncate: Joi.boolean().default(true),
		options: Joi.object().optional(),
		keep_alive: Joi.alternatives()
			.try(Joi.string(), Joi.number().integer().min(0))
			.optional(),
	});

	const embeddingsRequestSchema = Joi.object({
		model: Joi.string().required(),
		prompt: Joi.string().required(),
		options: Joi.object().optional(),
		keep_alive: Joi.alternatives()
			.try(Joi.string(), Joi.number().integer().min(0))
			.optional(),
	});

	// Helper function to validate model exists in the network
	const validateModelExists = (model: string) => {
		const availableModels = workerRegistry.getAllAvailableModels();
		if (!availableModels.includes(model)) {
			throw createError(
				`Model '${model}' is not available on any worker in the network`,
				404
			);
		}
		// Note: The job scheduler will queue the request and assign it when workers become available
	};

	// Helper function to stream response
	const streamResponse = (res: Response, data: any) => {
		res.write(JSON.stringify(data) + "\n");
	};

	// Helper function to convert GridLLM response to Ollama format
	const convertToOllamaResponse = (response: any, model: string) => {
		const ollamaResponse: any = {
			model,
			created_at: response.created_at || new Date().toISOString(),
			response: response.response || "",
			done: response.done || false,
			context: response.context || [],
			total_duration: response.total_duration || 0,
			load_duration: response.load_duration || 0,
			prompt_eval_count: response.prompt_eval_count || 0,
			prompt_eval_duration: response.prompt_eval_duration || 0,
			eval_count: response.eval_count || 0,
			eval_duration: response.eval_duration || 0,
		};

		// Include thinking field if present
		if (response.thinking) {
			ollamaResponse.thinking = response.thinking;
		}

		return ollamaResponse;
	};

	// API/GENERATE - Generate a completion
	router.post(
		"/api/generate",
		asyncHandler(async (req: Request, res: Response) => {
			const { error, value: validatedData } = generateRequestSchema.validate(
				req.body
			);
			if (error) {
				throw createError(
					`Validation error: ${error.details[0]?.message}`,
					400
				);
			}

			validateModelExists(validatedData.model);

			// Handle load/unload cases
			if (!validatedData.prompt || validatedData.prompt.trim() === "") {
				if (validatedData.keep_alive === 0) {
					// Unload model
					const unloadResponse = {
						model: validatedData.model,
						created_at: new Date().toISOString(),
						response: "",
						done: true,
						done_reason: "unload",
					};

					if (validatedData.stream) {
						res.setHeader("Content-Type", "application/json");
						streamResponse(res, unloadResponse);
						res.end();
					} else {
						res.json(unloadResponse);
					}
					return;
				} else {
					// Load model
					const loadResponse = {
						model: validatedData.model,
						created_at: new Date().toISOString(),
						response: "",
						done: true,
					};

					if (validatedData.stream) {
						res.setHeader("Content-Type", "application/json");
						streamResponse(res, loadResponse);
						res.end();
					} else {
						res.json(loadResponse);
					}
					return;
				}
			}

			const inferenceRequest: InferenceRequest = {
				id: uuidv4(),
				model: validatedData.model,
				prompt: validatedData.prompt,
				stream: validatedData.stream,
				options: validatedData.options || {},
				priority: "medium",
				timeout: 300000,
				metadata: {
					ollamaEndpoint: "/api/generate",
					suffix: validatedData.suffix,
					images: validatedData.images,
					think: validatedData.think,
					format: validatedData.format,
					system: validatedData.system,
					template: validatedData.template,
					raw: validatedData.raw,
					keep_alive: validatedData.keep_alive,
					context: validatedData.context,
					submittedAt: new Date().toISOString(),
					clientIp: req.ip,
					userAgent: req.get("User-Agent"),
				},
			};

			logger.job(inferenceRequest.id, "Ollama generate request submitted", {
				model: inferenceRequest.model,
				promptLength: inferenceRequest.prompt?.length || 0,
				stream: validatedData.stream,
			});

			try {
				if (validatedData.stream) {
					res.setHeader("Content-Type", "application/json");
					res.setHeader("Transfer-Encoding", "chunked");

					// Use real streaming from JobScheduler
					await jobScheduler.submitStreamingJob(
						inferenceRequest,
						// onChunk callback - called for each streaming chunk
						(chunk) => {
							logger.info("Received streaming chunk", {
								jobId: inferenceRequest.id,
								chunk: chunk,
								chunkKeys: Object.keys(chunk),
							});

							const ollamaChunk = convertToOllamaResponse(
								chunk,
								validatedData.model
							);
							logger.info("Converted to Ollama format", {
								jobId: inferenceRequest.id,
								ollamaChunk: ollamaChunk,
							});

							streamResponse(res, ollamaChunk);
						},
						// onComplete callback - called when streaming is done
						(result) => {
							const finalResponse = convertToOllamaResponse(
								result,
								validatedData.model
							);
							streamResponse(res, finalResponse);
							res.end();
						},
						// onError callback - called if there's an error
						(error) => {
							logger.job(
								inferenceRequest.id,
								"Ollama generate streaming request failed",
								{
									error: error.message,
								}
							);
							// Send error as Ollama-compatible response
							const errorResponse = {
								model: validatedData.model,
								created_at: new Date().toISOString(),
								response: "",
								done: true,
								error: error.message,
							};
							streamResponse(res, errorResponse);
							res.end();
						}
					);
				} else {
					const result = await jobScheduler.submitAndWait(inferenceRequest);
					const ollamaResponse = convertToOllamaResponse(
						result,
						validatedData.model
					);
					res.json(ollamaResponse);
				}
			} catch (error) {
				logger.job(inferenceRequest.id, "Ollama generate request failed", {
					error: error instanceof Error ? error.message : "Unknown error",
				});
				throw error;
			}
		})
	);

	// API/CHAT - Generate a chat completion
	router.post(
		"/api/chat",
		asyncHandler(async (req: Request, res: Response) => {
			const { error, value: validatedData } = chatRequestSchema.validate(
				req.body
			);
			if (error) {
				throw createError(
					`Validation error: ${error.details[0]?.message}`,
					400
				);
			}

			validateModelExists(validatedData.model);

			// Handle load/unload cases
			if (!validatedData.messages || validatedData.messages.length === 0) {
				if (validatedData.keep_alive === 0) {
					// Unload model
					const unloadResponse = {
						model: validatedData.model,
						created_at: new Date().toISOString(),
						message: { role: "assistant", content: "" },
						done_reason: "unload",
						done: true,
					};

					res.json(unloadResponse);
					return;
				} else {
					// Load model
					const loadResponse = {
						model: validatedData.model,
						created_at: new Date().toISOString(),
						message: { role: "assistant", content: "" },
						done_reason: "load",
						done: true,
					};

					res.json(loadResponse);
					return;
				}
			}

			// Convert chat messages to a single prompt
			const prompt =
				validatedData.messages
					.map((msg: any) => `${msg.role}: ${msg.content}`)
					.join("\n") + "\nassistant:";

			const inferenceRequest: InferenceRequest = {
				id: uuidv4(),
				model: validatedData.model,
				prompt,
				stream: validatedData.stream,
				options: validatedData.options || {},
				priority: "medium",
				timeout: 300000,
				metadata: {
					ollamaEndpoint: "/api/chat",
					messages: validatedData.messages,
					tools: validatedData.tools,
					think: validatedData.think,
					format: validatedData.format,
					keep_alive: validatedData.keep_alive,
					submittedAt: new Date().toISOString(),
					clientIp: req.ip,
					userAgent: req.get("User-Agent"),
				},
			};

			logger.job(inferenceRequest.id, "Ollama chat request submitted", {
				model: inferenceRequest.model,
				messageCount: validatedData.messages.length,
				stream: validatedData.stream,
			});

			try {
				if (validatedData.stream) {
					res.setHeader("Content-Type", "application/json");
					res.setHeader("Transfer-Encoding", "chunked");

					await jobScheduler.submitStreamingJob(
						inferenceRequest,
						// onChunk callback
						(chunk) => {
							const chatChunk: any = {
								model: validatedData.model,
								created_at: new Date().toISOString(),
								message: {
									role: "assistant",
									content: chunk.response || "",
									images: null,
								},
								done: chunk.done || false,
							};

							// Include thinking field if present
							if (chunk.thinking) {
								(chatChunk.message as any).thinking = chunk.thinking;
							}

							streamResponse(res, chatChunk);
						},
						// onComplete callback
						(result) => {
							const finalChatResponse: any = {
								model: validatedData.model,
								created_at: new Date().toISOString(),
								message: {
									role: "assistant",
									content: result.response || "",
								},
								done: true,
								total_duration: result.total_duration || 0,
								load_duration: result.load_duration || 0,
								prompt_eval_count: result.prompt_eval_count || 0,
								prompt_eval_duration: result.prompt_eval_duration || 0,
								eval_count: result.eval_count || 0,
								eval_duration: result.eval_duration || 0,
							};

							// Include thinking field if present
							if (result.thinking) {
								(finalChatResponse.message as any).thinking = result.thinking;
							}

							streamResponse(res, finalChatResponse);
							res.end();
						},
						// onError callback
						(error) => {
							logger.job(
								inferenceRequest.id,
								"Ollama chat streaming request failed",
								{
									error: error.message,
								}
							);
							const errorResponse = {
								model: validatedData.model,
								created_at: new Date().toISOString(),
								message: { role: "assistant", content: "" },
								done: true,
								error: error.message,
							};
							streamResponse(res, errorResponse);
							res.end();
						}
					);
				} else {
					const result = await jobScheduler.submitAndWait(inferenceRequest);
					const chatResponse: any = {
						model: validatedData.model,
						created_at: new Date().toISOString(),
						message: {
							role: "assistant",
							content: result.response || "",
						},
						done: true,
						total_duration: result.total_duration || 0,
						load_duration: result.load_duration || 0,
						prompt_eval_count: result.prompt_eval_count || 0,
						prompt_eval_duration: result.prompt_eval_duration || 0,
						eval_count: result.eval_count || 0,
						eval_duration: result.eval_duration || 0,
					};

					// Include thinking field if present
					if (result.thinking) {
						chatResponse.message.thinking = result.thinking;
					}

					res.json(chatResponse);
				}
			} catch (error) {
				logger.job(inferenceRequest.id, "Ollama chat request failed", {
					error: error instanceof Error ? error.message : "Unknown error",
				});
				throw error;
			}
		})
	);

	// API/TAGS - List local models
	router.get(
		"/api/tags",
		asyncHandler(async (req: Request, res: Response) => {
			try {
				const allWorkers = workerRegistry.getAllWorkers();
				const modelsMap = new Map<string, any>();
				const modelWorkerCount = new Map<string, number>();

				// Aggregate models from all workers
				for (const worker of allWorkers) {
					if (worker.capabilities && worker.capabilities.availableModels) {
						for (const model of worker.capabilities.availableModels) {
							// Count workers that have this model
							const currentCount = modelWorkerCount.get(model.name) || 0;
							modelWorkerCount.set(model.name, currentCount + 1);

							if (!modelsMap.has(model.name)) {
								modelsMap.set(model.name, {
									name: model.name,
									model: model.name,
									modified_at: model.modified_at || new Date().toISOString(),
									size: model.size || 0,
									digest: model.digest || "",
									details: model.details || {
										parent_model: "",
										format: "gguf",
										family: "unknown",
										families: ["unknown"],
										parameter_size: "Unknown",
										quantization_level: "Unknown",
									},
									gridllm_metadata: {
										num_workers_with_model: 0, // Will be updated below
									},
								});
							}
						}
					}
				}

				// Update worker counts for each model
				for (const [modelName, modelData] of modelsMap.entries()) {
					modelData.gridllm_metadata.num_workers_with_model =
						modelWorkerCount.get(modelName) || 0;
				}

				const models = Array.from(modelsMap.values()).sort((a, b) =>
					a.name.localeCompare(b.name)
				);

				logger.info("API/tags request completed", {
					modelsCount: models.length,
					workersCount: allWorkers.length,
				});

				res.json({ models });
			} catch (error) {
				logger.error("Error in /api/tags endpoint", error);
				res.status(500).json({
					error: "Internal server error",
					message: error instanceof Error ? error.message : "Unknown error",
				});
			}
		})
	);

	// API/EMBED - Generate embeddings
	router.post(
		"/api/embed",
		asyncHandler(async (req: Request, res: Response) => {
			const { error, value: validatedData } = embedRequestSchema.validate(
				req.body
			);
			if (error) {
				throw createError(
					`Validation error: ${error.details[0]?.message}`,
					400
				);
			}

			validateModelExists(validatedData.model);

			// Convert input to array if it's a string
			const inputs = Array.isArray(validatedData.input)
				? validatedData.input
				: [validatedData.input];

			const embeddingRequest: InferenceRequest = {
				id: uuidv4(),
				model: validatedData.model,
				input: inputs,
				options: validatedData.options || {},
				priority: "medium",
				timeout: 300000,
				metadata: {
					requestType: "embedding",
					ollamaEndpoint: "/api/embed",
					truncate: validatedData.truncate,
					keep_alive: validatedData.keep_alive,
					submittedAt: new Date().toISOString(),
					clientIp: req.ip,
					userAgent: req.get("User-Agent"),
				},
			};

			logger.job(embeddingRequest.id, "Ollama embed request submitted", {
				model: embeddingRequest.model,
				inputCount: inputs.length,
				inputLengths: inputs.map((input: string) => input.length),
			});

			try {
				const result = await jobScheduler.submitAndWait(embeddingRequest);

				// Convert GridLLM response to Ollama embed format
				const embedResponse = {
					model: validatedData.model,
					embeddings: result.embeddings || [],
					total_duration: result.total_duration || 0,
					load_duration: result.load_duration || 0,
					prompt_eval_count:
						result.prompt_eval_count ||
						inputs.reduce(
							(sum: number, input: string) => sum + input.split(" ").length,
							0
						),
				};

				res.json(embedResponse);
			} catch (error) {
				logger.job(embeddingRequest.id, "Ollama embed request failed", {
					error: error instanceof Error ? error.message : "Unknown error",
				});
				throw error;
			}
		})
	);

	// API/EMBEDDINGS - Generate embedding (legacy endpoint)
	router.post(
		"/api/embeddings",
		asyncHandler(async (req: Request, res: Response) => {
			const { error, value: validatedData } = embeddingsRequestSchema.validate(
				req.body
			);
			if (error) {
				throw createError(
					`Validation error: ${error.details[0]?.message}`,
					400
				);
			}

			validateModelExists(validatedData.model);

			const embeddingRequest: InferenceRequest = {
				id: uuidv4(),
				model: validatedData.model,
				input: [validatedData.prompt], // Convert to array format
				options: validatedData.options || {},
				priority: "medium",
				timeout: 300000,
				metadata: {
					requestType: "embedding",
					ollamaEndpoint: "/api/embeddings",
					keep_alive: validatedData.keep_alive,
					submittedAt: new Date().toISOString(),
					clientIp: req.ip,
					userAgent: req.get("User-Agent"),
				},
			};

			logger.job(
				embeddingRequest.id,
				"Ollama embeddings (legacy) request submitted",
				{
					model: embeddingRequest.model,
					promptLength: validatedData.prompt.length,
				}
			);

			try {
				const result = await jobScheduler.submitAndWait(embeddingRequest);

				// Convert GridLLM response to legacy Ollama embeddings format
				// The legacy endpoint returns a single embedding, not an array
				const embedding =
					result.embeddings && result.embeddings.length > 0
						? result.embeddings[0]
						: [];

				res.json({
					embedding,
				});
			} catch (error) {
				logger.job(
					embeddingRequest.id,
					"Ollama embeddings (legacy) request failed",
					{
						error: error instanceof Error ? error.message : "Unknown error",
					}
				);
				throw error;
			}
		})
	);

	return router;
};
