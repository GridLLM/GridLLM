async function queryOllamaGenerate(
	OLLAMA_HOST: string,
	OLLAMA_PORT: number,
	OLLAMA_PROTOCOL: string,
	model: string,
	prompt: string
) {
	const url = `${OLLAMA_PROTOCOL}://${OLLAMA_HOST}:${OLLAMA_PORT}/api/generate`;

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: model,
			prompt: prompt,
			stream: false,
		}),
	});

	console.log(response);

	if (!response.ok) {
		throw new Error(`Ollama API error: ${response.statusText}`);
	}

	return response.json();
}

// If run by ts-node or similar, execute the function
if (require.main === module) {
	const ollamaHost = process.env.OLLAMA_HOST || "localhost";
	const ollamaPort = parseInt(process.env.OLLAMA_PORT || "11434", 10);
	const ollamaProtocol = process.env.OLLAMA_PROTOCOL || "http";

	queryOllamaGenerate(
		ollamaHost,
		ollamaPort,
		ollamaProtocol,
		"qwen2.5:0.5b",
		"Hello, how are you?"
	)
		.then((response) => console.log("Response:", response))
		.catch((error) => console.error("Error:", error));
}
