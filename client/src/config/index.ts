import dotenv from "dotenv";
import Joi from "joi";

dotenv.config();

const envSchema = Joi.object({
	NODE_ENV: Joi.string()
		.valid("development", "production", "test")
		.default("development"),
	PORT: Joi.number().default(3000),

	// Redis Configuration
	REDIS_HOST: Joi.string().default("localhost"),
	REDIS_PORT: Joi.number().default(6379),
	REDIS_PASSWORD: Joi.string().allow("").default(""),
	REDIS_DB: Joi.number().default(0),
	REDIS_KEY_PREFIX: Joi.string().default("GridLLM:"),

	// Ollama Configuration
	OLLAMA_HOST: Joi.string().default("localhost"),
	OLLAMA_PORT: Joi.number().default(11434),
	OLLAMA_PROTOCOL: Joi.string().valid("http", "https").default("http"),
	OLLAMA_TIMEOUT: Joi.number().default(300000),
	OLLAMA_MAX_RETRIES: Joi.number().default(3),

	// Server Configuration (instead of broker)
	SERVER_HOST: Joi.string().default("localhost"),
	SERVER_PORT: Joi.number().default(4000),
	SERVER_REDIS_HOST: Joi.string().default("localhost"),
	SERVER_REDIS_PORT: Joi.number().default(6379),
	SERVER_REDIS_PASSWORD: Joi.string().allow("").default(""),

	// Worker Configuration
	WORKER_ID: Joi.string().default(
		`worker-${Math.random().toString(36).substr(2, 9)}`
	),
	WORKER_CONCURRENCY: Joi.number().default(2),
	WORKER_MAX_CONCURRENT_JOBS: Joi.number().default(5),
	WORKER_POLL_INTERVAL: Joi.number().default(1000),
	WORKER_RESOURCE_CHECK_INTERVAL: Joi.number().default(10000),

	// Monitoring & Logging
	LOG_LEVEL: Joi.string()
		.valid("error", "warn", "info", "debug")
		.default("info"),
	LOG_FILE_PATH: Joi.string().default("./logs/GridLLM-client.log"),
	METRICS_ENABLED: Joi.boolean().default(true),
	HEALTH_CHECK_INTERVAL: Joi.number().default(60000),

	// Task Configuration
	TASK_TIMEOUT: Joi.number().default(600000),
	TASK_RETRY_ATTEMPTS: Joi.number().default(3),
	TASK_RETRY_DELAY: Joi.number().default(5000),
	TASK_PRIORITY_WEIGHTS: Joi.string().default("high:3,medium:2,low:1"),

	// Rate Limiting
	RATE_LIMIT_WINDOW: Joi.number().default(60000),
	RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),
}).unknown();

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
	throw new Error(`Config validation error: ${error.message}`);
}

export const config = {
	env: envVars.NODE_ENV,
	port: envVars.PORT,

	redis: {
		host: envVars.SERVER_REDIS_HOST,
		port: envVars.SERVER_REDIS_PORT,
		password: envVars.SERVER_REDIS_PASSWORD || undefined,
		db: envVars.REDIS_DB,
		keyPrefix: envVars.REDIS_KEY_PREFIX,
		retryDelayOnFailover: 100,
		enableReadyCheck: false,
		maxRetriesPerRequest: 3,
	},

	ollama: {
		host: envVars.OLLAMA_HOST,
		port: envVars.OLLAMA_PORT,
		protocol: envVars.OLLAMA_PROTOCOL,
		timeout: envVars.OLLAMA_TIMEOUT,
		maxRetries: envVars.OLLAMA_MAX_RETRIES,
		baseUrl: `${envVars.OLLAMA_PROTOCOL}://${envVars.OLLAMA_HOST}:${envVars.OLLAMA_PORT}`,
	},

	server: {
		host: envVars.SERVER_HOST,
		port: envVars.SERVER_PORT,
		heartbeatInterval: 5000, // 5 seconds - much faster heartbeat
		reconnectDelay: 5000,
		maxReconnectAttempts: 10,
	},

	worker: {
		id: envVars.WORKER_ID,
		concurrency: envVars.WORKER_CONCURRENCY,
		maxConcurrentJobs: envVars.WORKER_MAX_CONCURRENT_JOBS,
		pollInterval: envVars.WORKER_POLL_INTERVAL,
		resourceCheckInterval: envVars.WORKER_RESOURCE_CHECK_INTERVAL,
	},

	logging: {
		level: envVars.LOG_LEVEL,
		filePath: envVars.LOG_FILE_PATH,
		metricsEnabled: envVars.METRICS_ENABLED,
		healthCheckInterval: envVars.HEALTH_CHECK_INTERVAL,
	},

	tasks: {
		timeout: envVars.TASK_TIMEOUT,
		retryAttempts: envVars.TASK_RETRY_ATTEMPTS,
		retryDelay: envVars.TASK_RETRY_DELAY,
		priorityWeights: parsePriorityWeights(envVars.TASK_PRIORITY_WEIGHTS),
	},

	rateLimit: {
		window: envVars.RATE_LIMIT_WINDOW,
		maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS,
	},

	broker: {
		authToken: process.env.BROKER_AUTH_TOKEN || "",
		maxReconnectAttempts: 5,
		reconnectDelay: 1000,
		heartbeatInterval: 5000,
	},
};

function parsePriorityWeights(weights: string): Record<string, number> {
	const result: Record<string, number> = {};
	const pairs = weights.split(",");

	for (const pair of pairs) {
		const [priority, weight] = pair.split(":");
		if (priority && weight) {
			result[priority.trim()] = parseInt(weight.trim(), 10);
		}
	}

	return result;
}

export default config;
