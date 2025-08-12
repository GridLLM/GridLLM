import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import Joi from "joi";
import { JobScheduler } from "@/services/JobScheduler";
import { WorkerRegistry } from "@/services/WorkerRegistry";
import {
	InferenceRequest,
	OpenAIChatCompletionsRequest,
	OpenAIChatMessage,
	OllamaChatMessage,
} from "@/types";
import { logger } from "@/utils/logger";
import { asyncHandler, createError } from "@/middleware/errorHandler";
import { stream } from "winston";

export const openaiRoutes = (
	jobScheduler: JobScheduler,
	workerRegistry: WorkerRegistry
): Router => {
	const router = Router();

	// Validation schema for OpenAI completions requests
	const completionsRequestSchema = Joi.object({
		model: Joi.string().required(),
		prompt: Joi.alternatives()
			.try(
				Joi.string(),
				Joi.array().items(Joi.string()),
				Joi.array().items(Joi.number()),
				Joi.array().items(Joi.array().items(Joi.number()))
			)
			.required(),
		best_of: Joi.number().integer().min(1).default(1),
		echo: Joi.boolean().default(false),
		frequency_penalty: Joi.number().min(-2.0).max(2.0).default(0),
		logit_bias: Joi.object().default({}),
		logprobs: Joi.number().integer().min(0).max(5).allow(null).default(null),
		max_tokens: Joi.number().integer().min(1).default(16),
		n: Joi.number().integer().min(1).default(1),
		presence_penalty: Joi.number().min(-2.0).max(2.0).default(0),
		seed: Joi.number().integer().allow(null).default(null),
		stop: Joi.alternatives()
			.try(Joi.string(), Joi.array().items(Joi.string()).max(4))
			.allow(null)
			.default(null),
		stream: Joi.boolean().default(false),
		stream_options: Joi.object({
			include_usage: Joi.boolean().default(false),
		})
			.allow(null)
			.default(null),
		suffix: Joi.string().allow(null).default(null),
		temperature: Joi.number().min(0).max(2).default(1),
		top_p: Joi.number().min(0).max(1).default(1),
		user: Joi.string().optional(),
	});

	// Validation schema for OpenAI chat completions requests
	const chatCompletionsRequestSchema = Joi.object({
		model: Joi.string().required(),
		messages: Joi.array()
			.items(
				Joi.object({
					role: Joi.string()
						.valid("system", "user", "assistant", "tool")
						.required(),
					content: Joi.alternatives()
						.try(
							Joi.string(),
							Joi.array().items(
								Joi.object({
									type: Joi.string().valid("text", "image_url").required(),
									text: Joi.string().when("type", {
										is: "text",
										then: Joi.required(),
									}),
									image_url: Joi.object({
										url: Joi.string().uri().required(),
										detail: Joi.string()
											.valid("auto", "low", "high")
											.default("auto"),
									}).when("type", { is: "image_url", then: Joi.required() }),
								})
							)
						)
						.required(),
					name: Joi.string().optional(),
					tool_calls: Joi.array()
						.items(
							Joi.object({
								id: Joi.string().required(),
								type: Joi.string().valid("function").required(),
								function: Joi.object({
									name: Joi.string().required(),
									arguments: Joi.string().required(),
								}).required(),
							})
						)
						.optional(),
					tool_call_id: Joi.string().optional(),
				})
			)
			.min(1)
			.required(),
		frequency_penalty: Joi.number().min(-2.0).max(2.0).default(0),
		logit_bias: Joi.object().default({}),
		logprobs: Joi.boolean().default(false),
		top_logprobs: Joi.number()
			.integer()
			.min(0)
			.max(20)
			.allow(null)
			.default(null),
		max_tokens: Joi.number().integer().min(1).allow(null).default(null),
		max_completion_tokens: Joi.number()
			.integer()
			.min(1)
			.allow(null)
			.default(null),
		n: Joi.number().integer().min(1).default(1),
		presence_penalty: Joi.number().min(-2.0).max(2.0).default(0),
		response_format: Joi.object({
			type: Joi.string()
				.valid("text", "json_object", "json_schema")
				.default("text"),
			json_schema: Joi.object({
				name: Joi.string(),
				description: Joi.string(),
				schema: Joi.object(),
				strict: Joi.boolean().default(false),
			}).when("type", { is: "json_schema", then: Joi.required() }),
		}).optional(),
		seed: Joi.number().integer().allow(null).default(null),
		stop: Joi.alternatives()
			.try(Joi.string(), Joi.array().items(Joi.string()).max(4))
			.allow(null)
			.default(null),
		stream: Joi.boolean().default(false),
		stream_options: Joi.object({
			include_usage: Joi.boolean().default(false),
		})
			.allow(null)
			.default(null),
		temperature: Joi.number().min(0).max(2).default(1),
		top_p: Joi.number().min(0).max(1).default(1),
		tools: Joi.array()
			.items(
				Joi.object({
					type: Joi.string().valid("function").required(),
					function: Joi.object({
						name: Joi.string().required(),
						description: Joi.string().optional(),
						parameters: Joi.object().optional(),
					}).required(),
				})
			)
			.optional(),
		tool_choice: Joi.alternatives()
			.try(
				Joi.string().valid("none", "auto", "required"),
				Joi.object({
					type: Joi.string().valid("function").required(),
					function: Joi.object({
						name: Joi.string().required(),
					}).required(),
				})
			)
			.default("auto"),
		parallel_tool_calls: Joi.boolean().default(true),
		user: Joi.string().optional(),
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
	};

	// Helper function to convert array prompt to string
	const convertPromptToString = (prompt: any): string => {
		if (typeof prompt === "string") {
			return prompt;
		}
		if (Array.isArray(prompt)) {
			if (prompt.length === 0) {
				return "";
			}
			// If array of strings, join them
			if (typeof prompt[0] === "string") {
				return prompt.join("\n");
			}
			// If array of tokens/arrays of tokens, we can't easily convert
			// For now, just stringify - this is not ideal but functional
			return JSON.stringify(prompt);
		}
		return String(prompt);
	};

	// Helper function to convert OpenAI messages to Ollama messages
	const convertOpenAIMessagesToOllama = (
		messages: OpenAIChatMessage[]
	): OllamaChatMessage[] => {
		return messages.map((msg) => {
			const ollamaMsg: OllamaChatMessage = {
				role: msg.role as "system" | "user" | "assistant" | "tool",
				content: "",
			};

			// Handle content conversion
			if (typeof msg.content === "string") {
				ollamaMsg.content = msg.content;
			} else if (Array.isArray(msg.content)) {
				// For multimodal content, extract text and images
				const textParts: string[] = [];
				const images: string[] = [];

				for (const part of msg.content) {
					if (part.type === "text" && part.text) {
						textParts.push(part.text);
					} else if (part.type === "image_url" && part.image_url?.url) {
						images.push(part.image_url.url);
					}
				}

				ollamaMsg.content = textParts.join("\n");
				if (images.length > 0) {
					ollamaMsg.images = images;
				}
			}

			// Handle tool calls
			if (msg.tool_calls && msg.tool_calls.length > 0) {
				ollamaMsg.tool_calls = msg.tool_calls;
			}

			return ollamaMsg;
		});
	};

	// Helper function to convert Ollama chat response to OpenAI format
	const convertOllamaChatToOpenAI = (
		response: any,
		model: string,
		requestId: string
	) => {
		const message = response.message || {};
		const promptTokens = response.prompt_eval_count || 0;
		const completionTokens = response.eval_count || 0;

		// Determine finish reason
		let finish_reason:
			| "stop"
			| "length"
			| "function_call"
			| "tool_calls"
			| "content_filter" = "stop";
		if (response.done_reason === "stop") {
			finish_reason = "stop";
		} else if (response.done_reason === "length") {
			finish_reason = "length";
		} else if (message.tool_calls && message.tool_calls.length > 0) {
			finish_reason = "tool_calls";
		}

		const choice: any = {
			index: 0,
			message: {
				role: "assistant",
				content: message.content || null,
			},
			logprobs: null,
			finish_reason,
		};

		// Add tool calls if present
		if (message.tool_calls && message.tool_calls.length > 0) {
			choice.message.tool_calls = message.tool_calls;
		}

		const result: any = {
			id: `chatcmpl-${requestId}`,
			object: "chat.completion" as const,
			created: Math.floor(Date.now() / 1000),
			model,
			choices: [choice],
			usage: {
				prompt_tokens: promptTokens,
				completion_tokens: completionTokens,
				total_tokens: promptTokens + completionTokens,
			},
		};

		// Pass through system_fingerprint from Ollama if available
		if (response.system_fingerprint) {
			result.system_fingerprint = response.system_fingerprint;
		}

		return result;
	};

	// Helper function to convert GridLLM response to OpenAI completions format
	const convertToOpenAICompletionsResponse = (
		response: any,
		model: string,
		requestId: string,
		prompt: string,
		echo: boolean = false,
		logprobs: number | null = null
	) => {
		const text = response.response || "";
		const promptTokens = response.prompt_eval_count || 0;
		const completionTokens = response.eval_count || 0;

		// Calculate finish_reason
		let finish_reason = "stop";
		if (response.done_reason === "stop") {
			finish_reason = "stop";
		} else if (response.done_reason === "length") {
			finish_reason = "length";
		} else if (response.eval_count === 0) {
			finish_reason = "length"; // Hit max_tokens limit
		}

		const choice: any = {
			text: echo ? prompt + text : text,
			index: 0,
			logprobs: null, // TODO: Implement logprobs if needed
			finish_reason,
		};

		const result: any = {
			id: `cmpl-${requestId}`,
			object: "text_completion",
			created: Math.floor(Date.now() / 1000),
			model,
			choices: [choice],
			usage: {
				prompt_tokens: promptTokens,
				completion_tokens: completionTokens,
				total_tokens: promptTokens + completionTokens,
			},
		};

		// Pass through system_fingerprint from Ollama if available
		if (response.system_fingerprint) {
			result.system_fingerprint = response.system_fingerprint;
		}

		return result;
	};

	// Helper function to stream OpenAI format response
	const streamOpenAIResponse = (res: Response, data: any) => {
		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};

	// V1/COMPLETIONS - OpenAI-compatible completions endpoint
	router.post(
		"/v1/completions",
		asyncHandler(async (req: Request, res: Response) => {
			const { error, value: validatedData } = completionsRequestSchema.validate(
				req.body
			);
			if (error) {
				res.status(400).json({
					error: {
						message: `Invalid request: ${error.details[0]?.message}`,
						type: "invalid_request_error",
						param: error.details[0]?.path.join(".") || null,
						code: "invalid_parameter",
					},
				});
				return;
			}

			validateModelExists(validatedData.model);

			// Convert prompt to string if needed
			const promptText = convertPromptToString(validatedData.prompt);

			// Convert OpenAI parameters to Ollama options
			const ollamaOptions: any = {};

			if (validatedData.temperature !== 1) {
				ollamaOptions.temperature = validatedData.temperature;
			}
			if (validatedData.top_p !== 1) {
				ollamaOptions.top_p = validatedData.top_p;
			}
			if (validatedData.max_tokens !== 16) {
				ollamaOptions.num_predict = validatedData.max_tokens;
			}
			if (validatedData.seed !== null) {
				ollamaOptions.seed = validatedData.seed;
			}
			if (validatedData.stop !== null) {
				ollamaOptions.stop = Array.isArray(validatedData.stop)
					? validatedData.stop
					: [validatedData.stop];
			}
			if (validatedData.frequency_penalty !== 0) {
				ollamaOptions.frequency_penalty = validatedData.frequency_penalty;
			}
			if (validatedData.presence_penalty !== 0) {
				ollamaOptions.presence_penalty = validatedData.presence_penalty;
			}

			const inferenceRequest: InferenceRequest = {
				id: uuidv4(),
				model: validatedData.model,
				prompt: promptText,
				stream: validatedData.stream,
				options: ollamaOptions,
				priority: "medium",
				timeout: 300000,
				metadata: {
					openaiEndpoint: "/v1/completions",
					originalRequest: {
						best_of: validatedData.best_of,
						echo: validatedData.echo,
						logprobs: validatedData.logprobs,
						n: validatedData.n,
						user: validatedData.user,
					},
					suffix: validatedData.suffix,
					submittedAt: new Date().toISOString(),
					clientIp: req.ip,
					userAgent: req.get("User-Agent"),
				},
			};

			logger.job(inferenceRequest.id, "OpenAI completions request submitted", {
				model: inferenceRequest.model,
				promptLength: promptText.length,
				stream: validatedData.stream,
				temperature: validatedData.temperature,
				max_tokens: validatedData.max_tokens,
			});

			try {
				if (validatedData.stream) {
					res.setHeader("Content-Type", "text/event-stream");
					res.setHeader("Cache-Control", "no-cache");
					res.setHeader("Connection", "keep-alive");
					res.setHeader("Access-Control-Allow-Origin", "*");

					let totalText = "";
					const created = Math.floor(Date.now() / 1000);

					await jobScheduler.submitStreamingJob(
						inferenceRequest,
						// onChunk callback
						(chunk) => {
							const deltaText = chunk.response || "";
							totalText += deltaText;

							const openaiChunk: any = {
								id: `cmpl-${inferenceRequest.id}`,
								object: "text_completion",
								created,
								model: validatedData.model,
								choices: [
									{
										text:
											validatedData.echo && totalText === deltaText
												? promptText + deltaText
												: deltaText,
										index: 0,
										logprobs: null,
										finish_reason: null,
									},
								],
							};

							// Pass through system_fingerprint from Ollama if available
							if (chunk.system_fingerprint) {
								openaiChunk.system_fingerprint = chunk.system_fingerprint;
							}

							streamOpenAIResponse(res, openaiChunk);
						},
						// onComplete callback
						(result) => {
							// Send final chunk with finish_reason
							const finalChunk: any = {
								id: `cmpl-${inferenceRequest.id}`,
								object: "text_completion",
								created,
								model: validatedData.model,
								choices: [
									{
										text: "",
										index: 0,
										logprobs: null,
										finish_reason: "stop",
									},
								],
								usage: {
									prompt_tokens: result.prompt_eval_count || 0,
									completion_tokens: result.eval_count || 0,
									total_tokens:
										(result.prompt_eval_count || 0) + (result.eval_count || 0),
								},
							};

							// Pass through system_fingerprint from Ollama if available
							if (result.system_fingerprint) {
								finalChunk.system_fingerprint = result.system_fingerprint;
							}

							// Only include usage in final chunk if stream_options.include_usage is true
							if (validatedData.stream_options?.include_usage) {
								streamOpenAIResponse(res, finalChunk);
							} else {
								// Send final chunk without usage
								const { usage, ...chunkWithoutUsage } = finalChunk;
								streamOpenAIResponse(res, chunkWithoutUsage);
							}

							// Send done signal
							streamOpenAIResponse(res, "[DONE]");
							res.end();
						},
						// onError callback
						(error) => {
							logger.job(
								inferenceRequest.id,
								"OpenAI completions streaming request failed",
								{
									error: error.message,
								}
							);

							const errorResponse = {
								error: {
									message: error.message,
									type: "server_error",
									code: "internal_error",
								},
							};
							streamOpenAIResponse(res, errorResponse);
							res.end();
						}
					);
				} else {
					// Non-streaming response
					const result = await jobScheduler.submitAndWait(inferenceRequest);
					const openaiResponse = convertToOpenAICompletionsResponse(
						result,
						validatedData.model,
						inferenceRequest.id,
						promptText,
						validatedData.echo,
						validatedData.logprobs
					);

					res.json(openaiResponse);
				}
			} catch (error) {
				logger.job(inferenceRequest.id, "OpenAI completions request failed", {
					error: error instanceof Error ? error.message : "Unknown error",
				});

				res.status(500).json({
					error: {
						message: error instanceof Error ? error.message : "Unknown error",
						type: "server_error",
						code: "internal_error",
					},
				});
			}
		})
	);

	// V1/CHAT/COMPLETIONS - OpenAI-compatible chat completions endpoint
	router.post(
		"/v1/chat/completions",
		asyncHandler(async (req: Request, res: Response) => {
			const { error, value: validatedData } =
				chatCompletionsRequestSchema.validate(req.body);
			if (error) {
				res.status(400).json({
					error: {
						message: `Invalid request: ${error.details[0]?.message}`,
						type: "invalid_request_error",
						param: error.details[0]?.path.join(".") || null,
						code: "invalid_parameter",
					},
				});
				return;
			}

			validateModelExists(validatedData.model);

			// Convert OpenAI messages to Ollama format
			const ollamaMessages = convertOpenAIMessagesToOllama(
				validatedData.messages
			);

			// Convert OpenAI parameters to Ollama options
			const ollamaOptions: any = {};

			if (validatedData.temperature !== 1) {
				ollamaOptions.temperature = validatedData.temperature;
			}
			if (validatedData.top_p !== 1) {
				ollamaOptions.top_p = validatedData.top_p;
			}
			if (
				validatedData.max_tokens !== null ||
				validatedData.max_completion_tokens !== null
			) {
				ollamaOptions.num_predict =
					validatedData.max_completion_tokens || validatedData.max_tokens;
			}
			if (validatedData.seed !== null) {
				ollamaOptions.seed = validatedData.seed;
			}
			if (validatedData.stop !== null) {
				ollamaOptions.stop = Array.isArray(validatedData.stop)
					? validatedData.stop
					: [validatedData.stop];
			}
			if (validatedData.frequency_penalty !== 0) {
				ollamaOptions.frequency_penalty = validatedData.frequency_penalty;
			}
			if (validatedData.presence_penalty !== 0) {
				ollamaOptions.presence_penalty = validatedData.presence_penalty;
			}

			// Handle response format
			if (validatedData.response_format?.type === "json_object") {
				ollamaOptions.format = "json";
			} else if (validatedData.response_format?.type === "json_schema") {
				ollamaOptions.format =
					validatedData.response_format.json_schema?.schema;
			}

			const inferenceRequest: InferenceRequest = {
				id: uuidv4(),
				model: validatedData.model,
				stream: validatedData.stream,
				options: ollamaOptions,
				priority: "medium",
				timeout: 300000,
				metadata: {
					openaiEndpoint: "/v1/chat/completions",
					requestType: "chat",
					ollamaEndpoint: "/api/chat",
					messages: ollamaMessages,
					originalRequest: {
						n: validatedData.n,
						logprobs: validatedData.logprobs,
						top_logprobs: validatedData.top_logprobs,
						tools: validatedData.tools,
						tool_choice: validatedData.tool_choice,
						parallel_tool_calls: validatedData.parallel_tool_calls,
						user: validatedData.user,
					},
					submittedAt: new Date().toISOString(),
					clientIp: req.ip,
					userAgent: req.get("User-Agent"),
				},
			};

			logger.job(
				inferenceRequest.id,
				"OpenAI chat completions request submitted",
				{
					model: inferenceRequest.model,
					messagesCount: ollamaMessages.length,
					stream: validatedData.stream,
					temperature: validatedData.temperature,
					max_tokens:
						validatedData.max_completion_tokens || validatedData.max_tokens,
					hasTools: validatedData.tools && validatedData.tools.length > 0,
				}
			);

			try {
				if (validatedData.stream) {
					res.setHeader("Content-Type", "text/event-stream");
					res.setHeader("Cache-Control", "no-cache");
					res.setHeader("Connection", "keep-alive");
					res.setHeader("Access-Control-Allow-Origin", "*");

					let totalContent = "";
					const created = Math.floor(Date.now() / 1000);

					await jobScheduler.submitStreamingJob(
						inferenceRequest,
						// onChunk callback
						(chunk) => {
							const deltaContent = chunk.message?.content || "";
							totalContent += deltaContent;

							const openaiChunk: any = {
								id: `chatcmpl-${inferenceRequest.id}`,
								object: "chat.completion.chunk" as const,
								created,
								model: validatedData.model,
								choices: [
									{
										index: 0,
										delta: {
											role:
												totalContent === deltaContent
													? ("assistant" as const)
													: undefined,
											content: deltaContent,
										},
										logprobs: null,
										finish_reason: null,
									},
								],
							};

							// Pass through system_fingerprint from Ollama if available
							if (chunk.system_fingerprint) {
								openaiChunk.system_fingerprint = chunk.system_fingerprint;
							}

							streamOpenAIResponse(res, openaiChunk);
						},
						// onComplete callback
						(result) => {
							// Send final chunk with finish_reason
							const finalChunk: any = {
								id: `chatcmpl-${inferenceRequest.id}`,
								object: "chat.completion.chunk" as const,
								created,
								model: validatedData.model,
								choices: [
									{
										index: 0,
										delta: {},
										logprobs: null,
										finish_reason: "stop" as const,
									},
								],
							};

							// Pass through system_fingerprint from Ollama if available
							if (result.system_fingerprint) {
								finalChunk.system_fingerprint = result.system_fingerprint;
							}

							// Include usage in final chunk if requested
							if (validatedData.stream_options?.include_usage) {
								finalChunk.usage = {
									prompt_tokens: result.prompt_eval_count || 0,
									completion_tokens: result.eval_count || 0,
									total_tokens:
										(result.prompt_eval_count || 0) + (result.eval_count || 0),
								};
							}

							streamOpenAIResponse(res, finalChunk);

							// Send done signal
							streamOpenAIResponse(res, "[DONE]");
							res.end();
						},
						// onError callback
						(error) => {
							logger.job(
								inferenceRequest.id,
								"OpenAI chat completions streaming request failed",
								{
									error: error.message,
								}
							);

							const errorResponse = {
								error: {
									message: error.message,
									type: "server_error",
									code: "internal_error",
								},
							};
							streamOpenAIResponse(res, errorResponse);
							res.end();
						}
					);
				} else {
					// Non-streaming response
					const result = await jobScheduler.submitAndWait(inferenceRequest);
					const openaiResponse = convertOllamaChatToOpenAI(
						result,
						validatedData.model,
						inferenceRequest.id
					);

					res.json(openaiResponse);
				}
			} catch (error) {
				logger.job(
					inferenceRequest.id,
					"OpenAI chat completions request failed",
					{
						error: error instanceof Error ? error.message : "Unknown error",
					}
				);

				res.status(500).json({
					error: {
						message: error instanceof Error ? error.message : "Unknown error",
						type: "server_error",
						code: "internal_error",
					},
				});
			}
		})
	);

	// V1/MODELS - OpenAI-compatible models endpoint
	router.get(
		"/v1/models",
		asyncHandler(async (req: Request, res: Response) => {
			try {
				const allWorkers = workerRegistry.getAllWorkers();
				const modelsMap = new Map<string, any>();

				// Aggregate models from all workers
				for (const worker of allWorkers) {
					if (worker.capabilities && worker.capabilities.availableModels) {
						for (const model of worker.capabilities.availableModels) {
							if (!modelsMap.has(model.name)) {
								modelsMap.set(model.name, {
									id: model.name,
									object: "model",
									created: Math.floor(
										new Date(model.modified_at || new Date()).getTime() / 1000
									),
									owned_by: "gridllm",
									permission: [],
									root: model.name,
									parent: null,
								});
							}
						}
					}
				}

				const models = Array.from(modelsMap.values()).sort((a, b) =>
					a.id.localeCompare(b.id)
				);

				logger.info("OpenAI /v1/models request completed", {
					modelsCount: models.length,
					workersCount: allWorkers.length,
				});

				res.json({
					object: "list",
					data: models,
				});
			} catch (error) {
				logger.error("Error in /v1/models endpoint", error);
				res.status(500).json({
					error: {
						message: error instanceof Error ? error.message : "Unknown error",
						type: "server_error",
						code: "internal_error",
					},
				});
			}
		})
	);

	return router;
};
