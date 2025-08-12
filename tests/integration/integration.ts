const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
const GRIDLLM_ENDPOINT =
	process.env.GRIDLLM_ENDPOINT || "http://localhost:4000";
const TEST_MODEL = process.env.TEST_MODEL || "qwen3:0.6b";

function areObjectsSimilar(obj1: any, obj2: any): boolean {
	// Ensure that both objects have the same keys
	// If false, print the key and its types
	const keys1 = Object.keys(obj1).sort();
	const keys2 = Object.keys(obj2).sort();
	if (
		keys1.length !== keys2.length ||
		!keys1.every((key, index) => key === keys2[index])
	) {
		console.log("Keys mismatch:", {
			ollamaKeys: keys1,
			gridllmKeys: keys2,
		});
		return false;
	}

	// Compare the typeof for each key
	// If false, print the key and its types
	for (const key of keys1) {
		if (typeof obj1[key] !== typeof obj2[key]) {
			console.log(`Type mismatch for key "${key}":`, {
				ollamaType: typeof obj1[key],
				gridllmType: typeof obj2[key],
			});
			return false;
		}
	}

	return true;
}

async function testOpenAIV1Models(): Promise<boolean> {
	// Query OLLAMA_ENDPOINT/v1/models
	const ollamaResponse = await fetch(`${OLLAMA_ENDPOINT}/v1/models`);
	const ollamaModels = await ollamaResponse.json();

	// Query GRIDLLM_ENDPOINT/v1/models
	const gridllmResponse = await fetch(`${GRIDLLM_ENDPOINT}/v1/models`);
	const gridllmModels = await gridllmResponse.json();

	// Compare the models
	return areObjectsSimilar(ollamaModels, gridllmModels);
}

async function testOpenAIV1Completions(): Promise<boolean> {
	// Query OLLAMA_ENDPOINT/v1/completions
	const ollamaResponse = await fetch(`${OLLAMA_ENDPOINT}/v1/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: TEST_MODEL,
			prompt: "Hello, world!",
			max_tokens: 5,
		}),
	});
	const ollamaCompletion = await ollamaResponse.json();

	// Query GRIDLLM_ENDPOINT/v1/completions
	const gridllmResponse = await fetch(`${GRIDLLM_ENDPOINT}/v1/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: TEST_MODEL,
			prompt: "Hello, world!",
			max_tokens: 5,
		}),
	});
	const gridllmCompletion = await gridllmResponse.json();

	// Compare the completions
	return areObjectsSimilar(ollamaCompletion, gridllmCompletion);
}

async function testOpenAIV1ChatCompletions(): Promise<boolean> {
	const ollamaResponse = await fetch(`${OLLAMA_ENDPOINT}/v1/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: TEST_MODEL,
			messages: [
				{
					role: "user",
					content: "What is the weather like in Boston today?",
				},
			],
			tools: [
				{
					type: "function",
					function: {
						name: "get_current_weather",
						description: "Get the current weather in a given location",
						parameters: {
							type: "object",
							properties: {
								location: {
									type: "string",
									description: "The city and state, e.g. San Francisco, CA",
								},
								unit: {
									type: "string",
									enum: ["celsius", "fahrenheit"],
								},
							},
							required: ["location"],
						},
					},
				},
			],
			tool_choice: "auto",
			stream: false,
		}),
	});
	const ollamaChatCompletion = await ollamaResponse.json();

	const gridllmResponse = await fetch(
		`${GRIDLLM_ENDPOINT}/v1/chat/completions`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: TEST_MODEL,
				messages: [
					{
						role: "user",
						content: "What is the weather like in Boston today?",
					},
				],
				tools: [
					{
						type: "function",
						function: {
							name: "get_current_weather",
							description: "Get the current weather in a given location",
							parameters: {
								type: "object",
								properties: {
									location: {
										type: "string",
										description: "The city and state, e.g. San Francisco, CA",
									},
									unit: {
										type: "string",
										enum: ["celsius", "fahrenheit"],
									},
								},
								required: ["location"],
							},
						},
					},
				],
				tool_choice: "auto",
				stream: false,
			}),
		}
	);
	const gridllmChatCompletion = await gridllmResponse.json();

	// Compare the chat completions
	return areObjectsSimilar(ollamaChatCompletion, gridllmChatCompletion);
}

async function main() {
	console.log(
		`Testing with Ollama: ${OLLAMA_ENDPOINT}, GridLLM: ${GRIDLLM_ENDPOINT}, Model: ${TEST_MODEL}`
	);

	let hasFailure = false;

	try {
		const v1models = await testOpenAIV1Models();
		console.log("/v1/models:", v1models);
		if (!v1models) hasFailure = true;
	} catch (error) {
		console.log("/v1/models: ERROR -", error);
		hasFailure = true;
	}

	try {
		const v1completions = await testOpenAIV1Completions();
		console.log("/v1/completions:", v1completions);
		if (!v1completions) hasFailure = true;
	} catch (error) {
		console.log("/v1/completions: ERROR -", error);
		hasFailure = true;
	}

	try {
		const v1chatCompletions = await testOpenAIV1ChatCompletions();
		console.log("/v1/chat/completions:", v1chatCompletions);
		if (!v1chatCompletions) hasFailure = true;
	} catch (error) {
		console.log("/v1/chat/completions: ERROR -", error);
		hasFailure = true;
	}

	if (hasFailure) {
		console.log("\n❌ Some integration tests failed!");
		process.exit(1);
	} else {
		console.log("\n✅ All integration tests passed!");
		process.exit(0);
	}
}

if (require.main === module) {
	main().catch((err) => {
		console.error("Error in main function:", err);
		process.exit(1);
	});
}
