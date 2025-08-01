interface OllamaResponse {
	[key: string]: any;
}

interface ModelInfo {
	name: string;
	model: string;
	modified_at: string;
	size: number;
	digest: string;
	details: {
		parent_model: string;
		format: string;
		family: string;
		families: string[];
		parameter_size: string;
		quantization_level: string;
	};
}

interface RunningModel {
	name: string;
	model: string;
	size: number;
	digest: string;
	details: {
		parent_model: string;
		format: string;
		family: string;
		families: string[];
		parameter_size: string;
		quantization_level: string;
	};
	expires_at: string;
	size_vram: number;
}

class OllamaAPITester {
	private baseURL: string;
	private testModel: string;

	constructor(
		baseURL: string = "http://localhost:11434",
		testModel: string = "llama3.2"
	) {
		this.baseURL = baseURL;
		this.testModel = testModel;
	}

	private async makeRequest(
		method: "GET" | "POST" | "DELETE" | "HEAD",
		endpoint: string,
		data?: any,
		headers?: any
	): Promise<any> {
		try {
			const config: RequestInit = {
				method,
				headers: {
					"Content-Type": "application/json",
					...headers,
				},
			};

			if (data && method !== "GET" && method !== "HEAD") {
				config.body =
					typeof data === "string" ? data : JSON.stringify(data);
			}

			console.log(`\n🔍 Testing ${method} ${endpoint}`);
			if (data && method !== "GET" && method !== "HEAD") {
				console.log("📤 Request data:", JSON.stringify(data, null, 2));
			}

			const response = await fetch(`${this.baseURL}${endpoint}`, config);

			if (!response.ok) {
				throw new Error(
					`HTTP ${response.status}: ${response.statusText}`
				);
			}

			console.log("✅ Success");

			let responseData: any = null;
			if (method !== "HEAD") {
				responseData = await response.json();
				console.log(
					"📥 Response:",
					JSON.stringify(responseData, null, 2)
				);
			} else {
				console.log("📥 HEAD response received");
			}

			return responseData;
		} catch (error: any) {
			console.log("❌ Error:", error.message);
			if (error.response) {
				console.log(
					"📥 Error response:",
					JSON.stringify(error.response, null, 2)
				);
			}
			throw error;
		}
	}

	// 1. Generate a completion
	async testGenerateCompletion(): Promise<void> {
		console.log("\n🚀 Testing Generate Completion");

		const data = {
			model: this.testModel,
			prompt: "Why is the sky blue?",
			stream: false,
		};

		await this.makeRequest("POST", "/api/generate", data);
	}

	// 2. Generate a chat completion
	async testChatCompletion(): Promise<void> {
		console.log("\n💬 Testing Chat Completion");

		const data = {
			model: this.testModel,
			messages: [
				{
					role: "user",
					content: "Hello, how are you?",
				},
			],
			stream: false,
		};

		await this.makeRequest("POST", "/api/chat", data);
	}

	// 4. List Local Models
	async testListModels(): Promise<ModelInfo[]> {
		console.log("\n📋 Testing List Local Models");

		const data = (await this.makeRequest("GET", "/api/tags")) as {
			models: ModelInfo[];
		};
		return data.models;
	}

	// 5. Show Model Information
	async testShowModel(): Promise<void> {
		console.log("\nℹ️ Testing Show Model Information");

		const data = {
			model: this.testModel,
		};

		await this.makeRequest("POST", "/api/show", data);
	}

	// 6. Copy a Model
	async testCopyModel(): Promise<void> {
		console.log("\n📋 Testing Copy Model");

		const data = {
			source: this.testModel,
			destination: "test-copy-model",
		};

		await this.makeRequest("POST", "/api/copy", data);
	}

	// 7. Delete a Model
	async testDeleteModel(): Promise<void> {
		console.log("\n🗑️ Testing Delete Model");

		const data = {
			model: "test-copy-model",
		};

		await this.makeRequest("DELETE", "/api/delete", data);
	}

	// 8. Pull a Model
	async testPullModel(): Promise<void> {
		console.log("\n⬇️ Testing Pull Model");

		const data = {
			model: "llama3.2",
			stream: false,
		};

		await this.makeRequest("POST", "/api/pull", data);
	}

	// 10. Generate Embeddings
	async testGenerateEmbeddings(): Promise<void> {
		console.log("\n🔢 Testing Generate Embeddings");

		const data = {
			model: "nomic-embed-text:latest",
			input: "Why is the sky blue?",
		};

		await this.makeRequest("POST", "/api/embed", data);
	}

	// 11. List Running Models
	async testListRunningModels(): Promise<RunningModel[]> {
		console.log("\n🏃 Testing List Running Models");

		const data = (await this.makeRequest("GET", "/api/ps")) as {
			models: RunningModel[];
		};
		return data.models;
	}

	// 12. Version
	async testVersion(): Promise<void> {
		console.log("\n📦 Testing Version");

		const data = (await this.makeRequest("GET", "/api/version")) as {
			version: string;
		};
		console.log(`Ollama version: ${data.version}`);
	}

	// 15. Test with different parameters
	async testAdvancedParameters(): Promise<void> {
		console.log("\n⚙️ Testing Advanced Parameters");

		const data = {
			model: this.testModel,
			prompt: "Generate a JSON response about colors",
			format: "json",
			stream: false,
			options: {
				temperature: 0.1,
				top_p: 0.9,
				num_predict: 100,
			},
		};

		await this.makeRequest("POST", "/api/generate", data);
	}

	// 16. Test with tools
	async testWithTools(): Promise<void> {
		console.log("\n🔧 Testing with Tools");

		const data = {
			model: this.testModel,
			messages: [
				{
					role: "user",
					content: "What's the weather like in Tokyo?",
				},
			],
			tools: [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get the weather in a given city",
						parameters: {
							type: "object",
							properties: {
								city: {
									type: "string",
									description:
										"The city to get the weather for",
								},
							},
							required: ["city"],
						},
					},
				},
			],
			stream: false,
		};

		await this.makeRequest("POST", "/api/chat", data);
	}

	// 17. Test structured outputs
	async testStructuredOutputs(): Promise<void> {
		console.log("\n📊 Testing Structured Outputs");

		const data = {
			model: this.testModel,
			prompt: "Ollama is 22 years old and is busy saving the world. Respond using JSON",
			stream: false,
			format: {
				type: "object",
				properties: {
					age: {
						type: "integer",
					},
					available: {
						type: "boolean",
					},
				},
				required: ["age", "available"],
			},
		};

		await this.makeRequest("POST", "/api/generate", data);
	}

	// 18. Test with images (for multimodal models)
	async testWithImages(): Promise<void> {
		console.log("\n🖼️ Testing with Images (for multimodal models)");

		// This is a minimal base64 encoded image (1x1 pixel)
		const minimalImage =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

		const data = {
			model: "llava",
			prompt: "What is in this image?",
			stream: false,
			images: [minimalImage],
		};

		try {
			await this.makeRequest("POST", "/api/generate", data);
		} catch (error) {
			console.log(
				"⚠️ Image test failed (expected if llava model not available)"
			);
		}
	}

	// 19. Test raw mode
	async testRawMode(): Promise<void> {
		console.log("\n🔧 Testing Raw Mode");

		const data = {
			model: this.testModel,
			prompt: "[INST] why is the sky blue? [/INST]",
			raw: true,
			stream: false,
		};

		await this.makeRequest("POST", "/api/generate", data);
	}

	// 20. Test reproducible outputs
	async testReproducibleOutputs(): Promise<void> {
		console.log("\n🎲 Testing Reproducible Outputs");

		const data = {
			model: this.testModel,
			prompt: "Why is the sky blue?",
			stream: false,
			options: {
				seed: 123,
				temperature: 0,
			},
		};

		await this.makeRequest("POST", "/api/generate", data);
	}

	// Run all tests
	async runAllTests(): Promise<void> {
		console.log("🧪 Starting Ollama API Tests");
		console.log("=====================================");

		try {
			// Basic endpoints
			await this.testVersion();
			await this.testListModels();
			await this.testListRunningModels();

			// Generation endpoints
			await this.testGenerateCompletion();
			await this.testChatCompletion();
			await this.testGenerateEmbeddings();

			// Model management
			await this.testShowModel();
			await this.testPullModel();

			// Advanced features
			await this.testAdvancedParameters();
			await this.testWithTools();
			await this.testStructuredOutputs();
			await this.testRawMode();
			await this.testReproducibleOutputs();
			await this.testWithImages();

			console.log("\n🎉 All tests completed!");
		} catch (error) {
			console.error("\n💥 Test suite failed:", error);
		}
	}
}

// Main execution
async function main() {
	const tester = new OllamaAPITester();
	await tester.runAllTests();
}

// Export for use in other modules
export { OllamaAPITester };

// Run if this file is executed directly
if (require.main === module) {
	main().catch(console.error);
}
