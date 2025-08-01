import axios, { AxiosInstance, AxiosResponse } from "axios";
import { config } from "@/config";
import { logger } from "@/utils/logger";
import {
	OllamaModel,
	InferenceRequest,
	InferenceResponse,
	SystemResources,
	StreamResponse,
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
			logger.info(
				`Found ${response.data.models.length} available models`
			);
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

			logger.info("Starting inference", {
				id: request.id,
				model: request.model,
				promptLength: request.prompt?.length || 0,
				think: payload.think,
			});

			const response: AxiosResponse<InferenceResponse> =
				await this.client.post("/api/generate", payload);

			const result = {
				...response.data,
				id: request.id,
			};

			logger.info("Ollama generate request completed", {
				model: request.model,
				promptLength: request.prompt?.length || 0,
				responseLength: result.response?.length || 0,
				duration: result.total_duration,
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

	async getSystemResources(): Promise<SystemResources> {
		try {
			// This would need to be implemented based on system monitoring
			// For now, return mock data - in production, integrate with system monitoring
			const cpuInfo = await this.getCpuInfo();
			const memoryInfo = await this.getMemoryInfo();
			const gpuInfo = await this.getGpuInfo();

			const resources: SystemResources = {
				cpuCores: cpuInfo.cores,
				totalMemoryMB: memoryInfo.total,
				availableMemoryMB: memoryInfo.available,
				cpuUsagePercent: cpuInfo.usage,
				memoryUsagePercent: memoryInfo.usage,
			};

			if (gpuInfo) {
				resources.gpuMemoryMB = gpuInfo.total;
				resources.availableGpuMemoryMB = gpuInfo.available;
				resources.gpuUsagePercent = gpuInfo.usage;
			}

			return resources;
		} catch (error) {
			logger.error("Failed to get system resources", error);
			throw new Error("Failed to retrieve system resources");
		}
	}

	private async getCpuInfo(): Promise<{ cores: number; usage: number }> {
		// Mock implementation - replace with actual system monitoring
		return {
			cores: 8,
			usage: Math.random() * 100,
		};
	}

	private async getMemoryInfo(): Promise<{
		total: number;
		available: number;
		usage: number;
	}> {
		// Mock implementation - replace with actual system monitoring
		const total = 16384; // 16GB
		const available = total * (0.3 + Math.random() * 0.4); // 30-70% available
		return {
			total,
			available: Math.floor(available),
			usage: Math.floor(((total - available) / total) * 100),
		};
	}

	private async getGpuInfo(): Promise<
		{ total: number; available: number; usage: number } | undefined
	> {
		// Mock implementation - replace with actual GPU monitoring
		// Return undefined if no GPU available
		if (Math.random() > 0.5) {
			return undefined;
		}

		const total = 24576; // 24GB GPU
		const available = total * (0.2 + Math.random() * 0.6); // 20-80% available
		return {
			total,
			available: Math.floor(available),
			usage: Math.floor(((total - available) / total) * 100),
		};
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
