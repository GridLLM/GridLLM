/**
 * Integration Tests for GridLLM
 *
 * These tests verify end-to-end functionality of the GridLLM system
 * including the server, client, Redis, and Ollama integration.
 */

import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";
import { RedisContainer, StartedRedisContainer } from "@testcontainers/redis";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

describe("GridLLM Integration Tests", () => {
	let redisContainer: StartedRedisContainer;
	let ollamaContainer: StartedTestContainer;
	let clientContainer: StartedTestContainer;
	let serverContainer: StartedTestContainer;
	let gridllmProcess: any;

	// Test configuration
	const REDIS_PORT = 6379;
	const OLLAMA_PORT = 11434;
	const SERVER_PORT = 4000;
	const CLIENT_PORT = 3000;

	beforeAll(async () => {
		console.log("Starting integration test containers...");

		// Start Redis container
		console.log("Starting Redis container...");
		redisContainer = await new RedisContainer("redis:7-alpine")
			.withExposedPorts(REDIS_PORT)
			.start();

		console.log(
			`Redis started on port ${redisContainer.getMappedPort(REDIS_PORT)}`
		);

		// Start Ollama container
		console.log("Starting Ollama container...");
		ollamaContainer = await new GenericContainer("ollama/ollama")
			.withExposedPorts(OLLAMA_PORT)
			.withWaitStrategy(Wait.forHttp("/api/version", OLLAMA_PORT))
			.withStartupTimeout(120000)
			.start();

		console.log(
			`Ollama started on port ${ollamaContainer.getMappedPort(
				OLLAMA_PORT
			)}`
		);

		// Start GridLLM server container
		console.log("Starting GridLLM server container...");
		clientContainer = await new GenericContainer("gridllm/client")
			.withExposedPorts(CLIENT_PORT)
			.start();

		// Pull a small model for testing
		console.log("Pulling Ollama model for testing...");
		try {
			await execAsync(
				`docker exec ${ollamaContainer.getId()} ollama pull llama3.2:1b`
			);
			console.log("Ollama model ready");
		} catch (error) {
			console.warn("Could not pull model, tests may be limited:", error);
		}

		// Create environment variables for GridLLM
		process.env.NODE_ENV = "test";
		process.env.REDIS_HOST = "localhost";
		process.env.REDIS_PORT = redisContainer
			.getMappedPort(REDIS_PORT)
			.toString();
		process.env.OLLAMA_HOST = "localhost";
		process.env.OLLAMA_PORT = ollamaContainer
			.getMappedPort(OLLAMA_PORT)
			.toString();
		process.env.SERVER_PORT = SERVER_PORT.toString();
		process.env.CLIENT_PORT = CLIENT_PORT.toString();
		process.env.LOG_LEVEL = "warn"; // Reduce noise in tests

		console.log("Environment configured for tests");
	}, 180000);
	afterAll(async () => {
		console.log("Cleaning up test containers...");

		// Stop GridLLM services if running
		if (gridllmProcess) {
			try {
				await execAsync("npm run bundle:stop");
			} catch (error) {
				console.warn("Could not stop GridLLM bundle:", error);
			}
		}

		// Stop containers
		if (redisContainer) {
			await redisContainer.stop();
		}
		if (ollamaContainer) {
			await ollamaContainer.stop();
		}

		console.log("Cleanup complete");
	}, 60000);

	// Health check tests
	describe("Service Health Checks", () => {
		test("should verify Redis connectivity", async () => {
			const redisHost = "localhost";
			const redisPort = redisContainer.getMappedPort(REDIS_PORT);

			// Test Redis connection using redis-cli ping
			const { stdout } = await execAsync(
				`redis-cli -h ${redisHost} -p ${redisPort} ping`
			);
			expect(stdout.trim()).toBe("PONG");
		});

		test("should verify Ollama connectivity", async () => {
			const ollamaHost = "localhost";
			const ollamaPort = ollamaContainer.getMappedPort(OLLAMA_PORT);

			// Test Ollama API
			const response = await fetch(
				`http://${ollamaHost}:${ollamaPort}/api/version`
			);
			expect(response.ok).toBe(true);

			const version = await response.json();
			expect(version).toHaveProperty("version");
		});

		test("should start GridLLM services with npm run bundle:full", async () => {
			console.log("Starting GridLLM services...");

			// Clean up any existing containers first
			try {
				await execAsync("npm run bundle:stop", { timeout: 30000 });
				console.log("Cleaned up existing containers");
			} catch (error) {
				console.log("No existing containers to clean up");
			}

			// Force remove any conflicting containers
			try {
				console.log("Removing any existing GridLLM containers...");
				await execAsync(
					"docker container rm -f gridllm-server-container gridllm-client-container gridllm-redis 2>/dev/null || true"
				);
				await execAsync(
					"docker network rm gridllm_gridllm-network 2>/dev/null || true"
				);
				console.log("Existing containers removed");
			} catch (error) {
				// Ignore cleanup errors
			}

			// Start GridLLM services using npm script
			try {
				console.log(
					"Starting GridLLM services with npm run bundle:full..."
				);
				await execAsync("npm run bundle:full", { timeout: 90000 });

				// Wait for services to be ready
				console.log("Waiting for services to be healthy...");

				// Poll server health endpoint
				let serverReady = false;
				for (let i = 0; i < 40; i++) {
					try {
						const response = await fetch(
							`http://localhost:${SERVER_PORT}/health`
						);
						if (response.ok) {
							serverReady = true;
							break;
						}
					} catch (error) {
						// Service not ready yet
					}
					await new Promise((resolve) => setTimeout(resolve, 3000));
				}

				expect(serverReady).toBe(true);
				console.log("Server is healthy");

				// Poll client health endpoint
				let clientReady = false;
				for (let i = 0; i < 40; i++) {
					try {
						const response = await fetch(
							`http://localhost:${CLIENT_PORT}/health`
						);
						if (response.ok) {
							clientReady = true;
							break;
						}
					} catch (error) {
						// Service not ready yet
					}
					await new Promise((resolve) => setTimeout(resolve, 3000));
				}

				expect(clientReady).toBe(true);
				console.log("Client is healthy");

				gridllmProcess = true; // Mark as running for cleanup
			} catch (error) {
				console.error("Failed to start GridLLM services:", error);
				throw error;
			}
		}, 180000);

		test("should verify server health endpoint", async () => {
			const response = await fetch(
				`http://localhost:${SERVER_PORT}/health`
			);
			expect(response.ok).toBe(true);

			const health = await response.json();
			expect(health).toHaveProperty("status");
		});

		test("should verify client health endpoint", async () => {
			const response = await fetch(
				`http://localhost:${CLIENT_PORT}/health`
			);
			expect(response.ok).toBe(true);

			const health = await response.json();
			expect(health).toHaveProperty("status");
		});
	});

	// Job processing tests
	describe("Job Processing Flow", () => {
		test("should process a simple inference job end-to-end", async () => {
			// TODO: Add actual end-to-end job processing test
			console.log("End-to-end job processing test placeholder");
			expect(true).toBe(true);
		});

		test("should handle worker registration and heartbeat", async () => {
			// TODO: Add worker registration test
			console.log("Worker registration test placeholder");
			expect(true).toBe(true);
		});

		test("should handle job queuing and distribution", async () => {
			// TODO: Add job queuing test
			console.log("Job queuing test placeholder");
			expect(true).toBe(true);
		});
	});

	// Error handling tests
	describe("Error Handling", () => {
		test("should handle invalid requests gracefully", async () => {
			// TODO: Add error handling tests
			console.log("Error handling test placeholder");
			expect(true).toBe(true);
		});

		test("should recover from service failures", async () => {
			// TODO: Add service failure recovery test
			console.log("Service failure recovery test placeholder");
			expect(true).toBe(true);
		});
	});

	// Performance tests
	describe("Performance Tests", () => {
		test("should handle concurrent requests", async () => {
			// TODO: Add concurrent request test
			console.log("Concurrent request test placeholder");
			expect(true).toBe(true);
		});

		test("should maintain performance under load", async () => {
			// TODO: Add load testing
			console.log("Load testing placeholder");
			expect(true).toBe(true);
		});
	});
});
