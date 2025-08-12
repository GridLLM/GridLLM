import axios, { AxiosInstance, AxiosResponse } from "axios";
import { config } from "@/config";
import { logger } from "@/utils/logger";
import {
	OllamaModel,
	InferenceRequest,
	InferenceResponse,
	StreamResponse,
	OllamaChatMessage,
} from "@/types";

export class OllamaService {
	private client: AxiosInstance;
	private isConnected: boolean = false;
	private lastHealthCheck: Date = new Date();

	constructor() {
		this.client = axios.create({
			baseURL: config.ollama.baseUrl,
			timeout: config.ollama.timeout,
			headers: {
				"Content-Type": "application/json",
			},
		});

		this.setupInterceptors();
	}

	private setupInterceptors(): void {
		this.client.interceptors.request.use(
			(config) => {
				logger.debug("Ollama request", {
					url: config.url,
					method: config.method,
					data: config.data,
				});
				return config;
			},
			(error) => {
				logger.error("Ollama request error", error);
				return Promise.reject(error);
			}
		);

		this.client.interceptors.response.use(
			(response) => {
				logger.debug("Ollama response", {
					status: response.status,
					data: response.data,
				});
				return response;
			},
			(error) => {
				logger.error("Ollama response error", {
					status: error.response?.status,
					message: error.message,
					data: error.response?.data,
				});
				this.isConnected = false;
				return Promise.reject(error);
			}
		);
	}

	async checkHealth(): Promise<boolean> {
		try {
			const response = await this.client.get("/api/version");
			this.isConnected = response.status === 200;
			this.lastHealthCheck = new Date();

			if (this.isConnected) {
				logger.debug("Ollama health check passed", {
					version: response.data,
				});
			}

			return this.isConnected;
		} catch (error) {
			this.isConnected = false;
			logger.warn("Ollama health check failed", error);
			return false;
		}
	}

	async getAvailableModels(): Promise<OllamaModel[]> {
		try {
			const response: AxiosResponse<{ models: OllamaModel[] }> =
				await this.client.get("/api/tags");
			logger.info(`Found ${response.data.models.length} available models`);
			return response.data.models;
		} catch (error) {
			logger.error("Failed to get available models", error);
			throw new Error("Failed to retrieve available models from Ollama");
		}
	}

	async generateResponse(
		request: InferenceRequest
	): Promise<InferenceResponse> {
		try {
			const payload: any = {
				model: request.model,
				prompt: request.prompt,
				stream: false,
				max_tokens: request.options?.num_predict || 128,
			};

			// Map GridLLM options to OpenAI parameters
			if (request.options?.temperature !== undefined) {
				payload.temperature = request.options.temperature;
			}
			if (request.options?.top_p !== undefined) {
				payload.top_p = request.options.top_p;
			}
			if (request.options?.seed !== undefined) {
				payload.seed = request.options.seed;
			}
			if (request.options?.stop !== undefined) {
				payload.stop = request.options.stop;
			}
			if (request.options?.frequency_penalty !== undefined) {
				payload.frequency_penalty = request.options.frequency_penalty;
			}
			if (request.options?.presence_penalty !== undefined) {
				payload.presence_penalty = request.options.presence_penalty;
			}

			// Add other metadata fields
			if (request.metadata?.suffix) {
				payload.suffix = request.metadata.suffix;
			}
			if (request.metadata?.user) {
				payload.user = request.metadata.user;
			}

			logger.info("Starting inference", {
				id: request.id,
				model: request.model,
				promptLength: request.prompt?.length || 0,
			});

			const response: AxiosResponse<any> = await this.client.post(
				"/v1/completions",
				payload
			);

			// Convert OpenAI response format back to GridLLM format
			const openaiData = response.data;
			const result: InferenceResponse = {
				id: request.id,
				model: openaiData.model,
				created_at: new Date(openaiData.created * 1000).toISOString(),
				response: openaiData.choices?.[0]?.text || "",
				done: true,
				done_reason: openaiData.choices?.[0]?.finish_reason || "stop",
				total_duration: 0, // OpenAI doesn't provide this
				load_duration: 0,
				prompt_eval_count: openaiData.usage?.prompt_tokens || 0,
				prompt_eval_duration: 0,
				eval_count: openaiData.usage?.completion_tokens || 0,
				eval_duration: 0,
				system_fingerprint: openaiData.system_fingerprint, // Pass through system_fingerprint
			};

			logger.info("Ollama generate request completed", {
				model: request.model,
				promptLength: request.prompt?.length || 0,
				responseLength: result.response?.length || 0,
				system_fingerprint: result.system_fingerprint,
			});
			return result;
		} catch (error) {
			logger.error("Inference failed", {
				id: request.id,
				model: request.model,
				error: error,
			});
			throw new Error(
				`Inference failed: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	}

	async *generateStreamResponse(
		request: InferenceRequest
	): AsyncGenerator<StreamResponse> {
		try {
			const payload: any = {
				model: request.model,
				prompt: request.prompt,
				stream: true,
				options: request.options || {},
			};

			// Add think parameter if present in metadata
			if (request.metadata?.think) {
				payload.think = request.metadata.think;
			}

			// Add other metadata fields that should be passed to Ollama
			if (request.metadata?.suffix) {
				payload.suffix = request.metadata.suffix;
			}
			if (request.metadata?.images) {
				payload.images = request.metadata.images;
			}
			if (request.metadata?.format) {
				payload.format = request.metadata.format;
			}
			if (request.metadata?.system) {
				payload.system = request.metadata.system;
			}
			if (request.metadata?.template) {
				payload.template = request.metadata.template;
			}
			if (request.metadata?.raw) {
				payload.raw = request.metadata.raw;
			}
			if (request.metadata?.keep_alive) {
				payload.keep_alive = request.metadata.keep_alive;
			}
			if (request.metadata?.context) {
				payload.context = request.metadata.context;
			}

			logger.info("Starting streaming inference", {
				id: request.id,
				model: request.model,
				promptLength: request.prompt?.length || 0,
				think: payload.think,
			});

			const response = await this.client.post("/api/generate", payload, {
				responseType: "stream",
			});

			let buffer = "";

			for await (const chunk of response.data) {
				buffer += chunk.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (line.trim()) {
						try {
							const data = JSON.parse(line);
							yield {
								id: request.id,
								response: data.response || "",
								done: data.done || false,
							};

							if (data.done) {
								logger.info("Streaming inference completed", {
									id: request.id,
									hasThinking: !!data.thinking,
								});
								return;
							}
						} catch (parseError) {
							logger.warn("Failed to parse streaming response", {
								line,
								error: parseError,
							});
						}
					}
				}
			}
		} catch (error) {
			logger.error("Streaming inference failed", {
				id: request.id,
				model: request.model,
				error: error,
			});
			throw new Error(
				`Streaming inference failed: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	}

	async pullModel(modelName: string): Promise<void> {
		try {
			logger.info("Pulling model", { model: modelName });

			const response = await this.client.post("/api/pull", {
				name: modelName,
				stream: false,
			});

			if (response.status === 200) {
				logger.info("Model pulled successfully", { model: modelName });
			}
		} catch (error) {
			logger.error("Failed to pull model", {
				model: modelName,
				error: error,
			});
			throw new Error(
				`Failed to pull model ${modelName}: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	}

	async deleteModel(modelName: string): Promise<void> {
		try {
			logger.info("Deleting model", { model: modelName });

			await this.client.delete("/api/delete", {
				data: { name: modelName },
			});

			logger.info("Model deleted successfully", { model: modelName });
		} catch (error) {
			logger.error("Failed to delete model", {
				model: modelName,
				error: error,
			});
			throw new Error(
				`Failed to delete model ${modelName}: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	}

	getConnectionStatus(): { isConnected: boolean; lastHealthCheck: Date } {
		return {
			isConnected: this.isConnected,
			lastHealthCheck: this.lastHealthCheck,
		};
	}

	async validateModel(modelName: string): Promise<boolean> {
		try {
			const models = await this.getAvailableModels();
			return models.some((model) => model.name === modelName);
		} catch (error) {
			logger.error("Failed to validate model", {
				model: modelName,
				error,
			});
			return false;
		}
	}

	async generateChatResponse(
		request: InferenceRequest
	): Promise<InferenceResponse> {
		try {
			if (!request.metadata?.messages) {
				throw new Error("Chat request must include messages in metadata");
			}

			const payload: any = {
				model: request.model,
				messages: request.metadata.messages,
				stream: false,
			};

			// Map GridLLM options to OpenAI parameters
			if (request.options?.temperature !== undefined) {
				payload.temperature = request.options.temperature;
			}
			if (request.options?.top_p !== undefined) {
				payload.top_p = request.options.top_p;
			}
			if (request.options?.num_predict !== undefined) {
				payload.max_tokens = request.options.num_predict;
			}
			if (request.options?.seed !== undefined) {
				payload.seed = request.options.seed;
			}
			if (request.options?.stop !== undefined) {
				payload.stop = request.options.stop;
			}
			if (request.options?.frequency_penalty !== undefined) {
				payload.frequency_penalty = request.options.frequency_penalty;
			}
			if (request.options?.presence_penalty !== undefined) {
				payload.presence_penalty = request.options.presence_penalty;
			}

			// Add other metadata fields
			if (request.metadata?.tools) {
				payload.tools = request.metadata.tools;
			}
			if (request.metadata?.tool_choice) {
				payload.tool_choice = request.metadata.tool_choice;
			}
			if (request.metadata?.user) {
				payload.user = request.metadata.user;
			}

			logger.info("Starting chat inference", {
				id: request.id,
				model: request.model,
				messagesCount: request.metadata.messages.length,
			});

			const response: AxiosResponse<any> = await this.client.post(
				"/v1/chat/completions",
				payload
			);

			// Convert OpenAI response format back to GridLLM format
			const openaiData = response.data;
			const result: InferenceResponse = {
				id: request.id,
				model: openaiData.model,
				created_at: new Date(openaiData.created * 1000).toISOString(),
				message: openaiData.choices?.[0]?.message || {},
				done: true,
				done_reason: openaiData.choices?.[0]?.finish_reason || "stop",
				total_duration: 0, // OpenAI doesn't provide this
				load_duration: 0,
				prompt_eval_count: openaiData.usage?.prompt_tokens || 0,
				prompt_eval_duration: 0,
				eval_count: openaiData.usage?.completion_tokens || 0,
				eval_duration: 0,
				system_fingerprint: openaiData.system_fingerprint, // Pass through system_fingerprint
			};

			logger.info("Ollama chat request completed", {
				model: request.model,
				messagesCount: request.metadata.messages.length,
				responseLength: result.message?.content?.length || 0,
				system_fingerprint: result.system_fingerprint,
			});
			return result;
		} catch (error) {
			logger.error("Chat inference failed", {
				id: request.id,
				model: request.model,
				error: error,
			});
			throw new Error(
				`Chat inference failed: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	}

	async *generateChatStreamResponse(
		request: InferenceRequest
	): AsyncGenerator<StreamResponse> {
		try {
			if (!request.metadata?.messages) {
				throw new Error("Chat request must include messages in metadata");
			}

			const payload: any = {
				model: request.model,
				messages: request.metadata.messages,
				stream: true,
			};

			// Map GridLLM options to OpenAI parameters
			if (request.options?.temperature !== undefined) {
				payload.temperature = request.options.temperature;
			}
			if (request.options?.top_p !== undefined) {
				payload.top_p = request.options.top_p;
			}
			if (request.options?.num_predict !== undefined) {
				payload.max_tokens = request.options.num_predict;
			}
			if (request.options?.seed !== undefined) {
				payload.seed = request.options.seed;
			}
			if (request.options?.stop !== undefined) {
				payload.stop = request.options.stop;
			}
			if (request.options?.frequency_penalty !== undefined) {
				payload.frequency_penalty = request.options.frequency_penalty;
			}
			if (request.options?.presence_penalty !== undefined) {
				payload.presence_penalty = request.options.presence_penalty;
			}

			// Add other metadata fields
			if (request.metadata?.tools) {
				payload.tools = request.metadata.tools;
			}
			if (request.metadata?.tool_choice) {
				payload.tool_choice = request.metadata.tool_choice;
			}
			if (request.metadata?.user) {
				payload.user = request.metadata.user;
			}

			logger.info("Starting chat stream inference", {
				id: request.id,
				model: request.model,
				messagesCount: request.metadata.messages.length,
			});

			const response = await this.client.post("/v1/chat/completions", payload, {
				responseType: "stream",
			});

			const stream = response.data as NodeJS.ReadableStream;
			let buffer = "";

			for await (const chunk of stream) {
				buffer += chunk.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || ""; // Keep incomplete line in buffer

				for (const line of lines) {
					if (line.trim()) {
						// Skip data: prefix and handle [DONE] signal
						const cleanLine = line.replace(/^data: /, "");
						if (cleanLine === "[DONE]") {
							logger.info("Chat streaming completed", { id: request.id });
							return;
						}

						try {
							const data = JSON.parse(cleanLine);
							const deltaContent = data.choices?.[0]?.delta?.content || "";

							yield {
								id: request.id,
								response: deltaContent,
								done: data.choices?.[0]?.finish_reason !== null,
								message: {
									content: deltaContent,
									role: data.choices?.[0]?.delta?.role || "assistant",
								},
								system_fingerprint: data.system_fingerprint,
								...data,
							};

							// Check if we're done
							if (data.choices?.[0]?.finish_reason) {
								logger.info("Chat streaming inference completed", {
									id: request.id,
									finish_reason: data.choices[0].finish_reason,
								});
								return;
							}
						} catch (parseError) {
							logger.warn("Failed to parse stream chunk", {
								line: cleanLine,
								error: parseError,
							});
						}
					}
				}
			}

			// Process any remaining buffer
			if (buffer.trim()) {
				const cleanLine = buffer.replace(/^data: /, "");
				if (cleanLine !== "[DONE]") {
					try {
						const data = JSON.parse(cleanLine);
						const deltaContent = data.choices?.[0]?.delta?.content || "";

						yield {
							id: request.id,
							response: deltaContent,
							done: data.choices?.[0]?.finish_reason !== null,
							message: {
								content: deltaContent,
								role: data.choices?.[0]?.delta?.role || "assistant",
							},
							system_fingerprint: data.system_fingerprint,
							...data,
						};
					} catch (parseError) {
						logger.warn("Failed to parse final stream chunk", {
							buffer: cleanLine,
							error: parseError,
						});
					}
				}
			}
		} catch (error) {
			logger.error("Chat stream inference failed", {
				id: request.id,
				model: request.model,
				error: error,
			});
			throw new Error(
				`Chat stream inference failed: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	}

	async generateEmbedding(
		request: InferenceRequest
	): Promise<InferenceResponse> {
		try {
			logger.info("Starting embedding generation", {
				id: request.id,
				model: request.model,
				inputType: Array.isArray(request.input) ? "array" : "string",
				inputLength: Array.isArray(request.input)
					? request.input.length
					: request.input?.length || 0,
			});

			// Ensure we have input for embedding
			if (!request.input) {
				throw new Error("Input is required for embedding requests");
			}

			const payload: any = {
				model: request.model,
				input: request.input,
				options: request.options || {},
			};

			// Add optional parameters
			if (request.metadata?.truncate !== undefined) {
				payload.truncate = request.metadata.truncate;
			}
			if (request.metadata?.keep_alive !== undefined) {
				payload.keep_alive = request.metadata.keep_alive;
			}

			const response: AxiosResponse = await this.client.post(
				"/api/embed",
				payload
			);

			// Convert Ollama embedding response to InferenceResponse format
			const embeddingData = response.data;
			const result: InferenceResponse = {
				id: request.id,
				model: embeddingData.model,
				embeddings: embeddingData.embeddings,
				total_duration: embeddingData.total_duration,
				load_duration: embeddingData.load_duration,
				prompt_eval_count: embeddingData.prompt_eval_count,
			};

			return result;
		} catch (error) {
			logger.error("Embedding generation failed", {
				model: request.model,
				inputType: Array.isArray(request.input) ? "array" : "string",
				inputLength: Array.isArray(request.input)
					? request.input.length
					: request.input?.length || 0,
				error: error instanceof Error ? error.message : "Unknown error",
			});
			throw new Error(
				`Embedding failed: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	}
}

export default OllamaService;
