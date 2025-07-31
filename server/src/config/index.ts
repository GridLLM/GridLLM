import dotenv from "dotenv";
import Joi from "joi";

dotenv.config();

const envSchema = Joi.object({
	NODE_ENV: Joi.string()
		.valid("development", "production", "test")
		.default("development"),
	PORT: Joi.number().default(4000),

	// Redis Configuration
	REDIS_HOST: Joi.string().default("localhost"),
	REDIS_PORT: Joi.number().default(6379),
	REDIS_PASSWORD: Joi.string().allow("").default(""),
	REDIS_DB: Joi.number().default(0),
	REDIS_KEY_PREFIX: Joi.string().default("GridLLM:"),

	// Server Configuration
	SERVER_ID: Joi.string().default(
		`server-${Math.random().toString(36).substr(2, 9)}`
	),
	WORKER_TIMEOUT: Joi.number().default(300000), // 5 minutes
	WORKER_HEARTBEAT_TIMEOUT: Joi.number().default(15000), // 15 seconds - much faster
	WORKER_CLEANUP_INTERVAL: Joi.number().default(5000), // 5 seconds - much faster

	// Job Configuration
	JOB_TIMEOUT: Joi.number().default(600000), // 10 minutes
	JOB_RETRY_ATTEMPTS: Joi.number().default(3),
	JOB_RETRY_DELAY: Joi.number().default(5000),
	MAX_CONCURRENT_JOBS_PER_WORKER: Joi.number().default(1),

	// Monitoring & Logging
	LOG_LEVEL: Joi.string()
		.valid("error", "warn", "info", "debug")
		.default("info"),
	LOG_FILE_PATH: Joi.string().default("./logs/GridLLM-server.log"),
	HEALTH_CHECK_INTERVAL: Joi.number().default(60000),

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
		host: envVars.REDIS_HOST,
		port: envVars.REDIS_PORT,
		password: envVars.REDIS_PASSWORD || undefined,
		db: envVars.REDIS_DB,
		keyPrefix: envVars.REDIS_KEY_PREFIX,
		retryDelayOnFailover: 100,
		enableReadyCheck: false,
		maxRetriesPerRequest: 3,
	},

	server: {
		id: envVars.SERVER_ID,
		workerTimeout: envVars.WORKER_TIMEOUT,
		workerHeartbeatTimeout: envVars.WORKER_HEARTBEAT_TIMEOUT,
		workerCleanupInterval: envVars.WORKER_CLEANUP_INTERVAL,
	},

	jobs: {
		timeout: envVars.JOB_TIMEOUT,
		retryAttempts: envVars.JOB_RETRY_ATTEMPTS,
		retryDelay: envVars.JOB_RETRY_DELAY,
		maxConcurrentJobsPerWorker: envVars.MAX_CONCURRENT_JOBS_PER_WORKER,
	},

	logging: {
		level: envVars.LOG_LEVEL,
		filePath: envVars.LOG_FILE_PATH,
		healthCheckInterval: envVars.HEALTH_CHECK_INTERVAL,
	},

	rateLimit: {
		window: envVars.RATE_LIMIT_WINDOW,
		maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS,
	},
};

export default config;
