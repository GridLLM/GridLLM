import Redis from "ioredis";
import { config } from "@/config";
import { logger } from "@/utils/logger";

export class RedisConnectionManager {
	private static instance: RedisConnectionManager;
	private redis: Redis | null = null;
	private subscriber: Redis | null = null;
	private publisher: Redis | null = null;
	private isConnected: boolean = false;
	private reconnectAttempts: number = 0;
	private maxReconnectAttempts: number = 10;

	private constructor() {}

	static getInstance(): RedisConnectionManager {
		if (!RedisConnectionManager.instance) {
			RedisConnectionManager.instance = new RedisConnectionManager();
		}
		return RedisConnectionManager.instance;
	}

	async connect(): Promise<void> {
		try {
			if (this.isConnected) {
				logger.debug("Redis already connected");
				return;
			}

			logger.info("Connecting to Redis...", {
				host: config.redis.host,
				port: config.redis.port,
				db: config.redis.db,
			});

			// Main Redis connection
			this.redis = new Redis({
				host: config.redis.host,
				port: config.redis.port,
				password: config.redis.password,
				db: config.redis.db,
				keyPrefix: config.redis.keyPrefix,
				enableReadyCheck: config.redis.enableReadyCheck,
				maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
				lazyConnect: true,
				reconnectOnError: (err: Error) => {
					logger.warn("Redis reconnecting on error", {
						error: err.message,
					});
					return true;
				},
			});

			// Subscriber connection (separate connection for pub/sub)
			this.subscriber = new Redis({
				host: config.redis.host,
				port: config.redis.port,
				password: config.redis.password,
				db: config.redis.db,
				keyPrefix: config.redis.keyPrefix,
				lazyConnect: true,
			});

			// Publisher connection (separate connection for pub/sub)
			this.publisher = new Redis({
				host: config.redis.host,
				port: config.redis.port,
				password: config.redis.password,
				db: config.redis.db,
				keyPrefix: config.redis.keyPrefix,
				lazyConnect: true,
			});

			// Setup event handlers
			this.setupEventHandlers();

			// Connect all instances
			await Promise.all([
				this.redis.connect(),
				this.subscriber.connect(),
				this.publisher.connect(),
			]);

			this.isConnected = true;
			this.reconnectAttempts = 0;
			logger.info("Redis connected successfully");
		} catch (error) {
			logger.error("Failed to connect to Redis", error);
			this.isConnected = false;
			throw error;
		}
	}

	private setupEventHandlers(): void {
		if (!this.redis || !this.subscriber || !this.publisher) return;

		// Main connection events
		this.redis.on("connect", () => {
			logger.info("Redis main connection established");
		});

		this.redis.on("ready", () => {
			logger.info("Redis main connection ready");
			this.isConnected = true;
			this.reconnectAttempts = 0;
		});

		this.redis.on("error", (error) => {
			logger.error("Redis main connection error", error);
			this.isConnected = false;
		});

		this.redis.on("close", () => {
			logger.warn("Redis main connection closed");
			this.isConnected = false;
			// Notify server about worker disconnection if we have worker ID
			this.notifyWorkerDisconnection();
		});

		this.redis.on("reconnecting", (delay: number) => {
			this.reconnectAttempts++;
			logger.info("Redis main connection reconnecting", {
				delay,
				attempt: this.reconnectAttempts,
			});

			if (this.reconnectAttempts >= this.maxReconnectAttempts) {
				logger.error("Max Redis reconnection attempts reached");
				this.redis?.disconnect();
			}
		});

		// Subscriber events
		this.subscriber.on("error", (error) => {
			logger.error("Redis subscriber error", error);
		});

		this.subscriber.on("close", () => {
			logger.warn("Redis subscriber connection closed");
			this.notifyWorkerDisconnection();
		});

		this.subscriber.on("message", (channel, message) => {
			logger.debug("Redis message received", { channel, message });
		});

		// Publisher events
		this.publisher.on("error", (error) => {
			logger.error("Redis publisher error", error);
		});

		this.publisher.on("close", () => {
			logger.warn("Redis publisher connection closed");
			this.notifyWorkerDisconnection();
		});
	}

	private async notifyWorkerDisconnection(): Promise<void> {
		try {
			// Try to notify server about disconnection if possible
			// Use a different Redis connection or the publisher if it's still available
			if (this.publisher && this.publisher.status === "ready") {
				const workerId = config.worker.id;
				if (workerId) {
					await this.publisher.publish(
						"worker:disconnected",
						JSON.stringify({
							workerId,
							timestamp: new Date().toISOString(),
							reason: "connection_lost",
						})
					);
					logger.warn(`Notified server about worker ${workerId} disconnection`);
				}
			}
		} catch (error) {
			logger.error("Failed to notify server about worker disconnection", error);
		}
	}

	async disconnect(): Promise<void> {
		try {
			logger.info("Disconnecting from Redis...");

			const disconnectPromises = [];

			if (this.redis) {
				disconnectPromises.push(this.redis.disconnect());
			}

			if (this.subscriber) {
				disconnectPromises.push(this.subscriber.disconnect());
			}

			if (this.publisher) {
				disconnectPromises.push(this.publisher.disconnect());
			}

			await Promise.all(disconnectPromises);

			this.redis = null;
			this.subscriber = null;
			this.publisher = null;
			this.isConnected = false;

			logger.info("Redis disconnected successfully");
		} catch (error) {
			logger.error("Error disconnecting from Redis", error);
			throw error;
		}
	}

	getMainConnection(): Redis {
		if (!this.redis || !this.isConnected) {
			throw new Error("Redis not connected. Call connect() first.");
		}
		return this.redis;
	}

	getSubscriber(): Redis {
		if (!this.subscriber || !this.isConnected) {
			throw new Error("Redis subscriber not connected. Call connect() first.");
		}
		return this.subscriber;
	}

	getPublisher(): Redis {
		if (!this.publisher || !this.isConnected) {
			throw new Error("Redis publisher not connected. Call connect() first.");
		}
		return this.publisher;
	}

	async ping(): Promise<boolean> {
		try {
			if (!this.redis) return false;
			const result = await this.redis.ping();
			return result === "PONG";
		} catch (error) {
			logger.error("Redis ping failed", error);
			return false;
		}
	}

	getConnectionStatus(): {
		isConnected: boolean;
		reconnectAttempts: number;
		status: string;
	} {
		return {
			isConnected: this.isConnected,
			reconnectAttempts: this.reconnectAttempts,
			status: this.redis?.status || "disconnected",
		};
	}

	async subscribe(
		channel: string,
		callback: (message: string) => void
	): Promise<void> {
		if (!this.subscriber || !this.isConnected) {
			throw new Error("Redis subscriber not available");
		}

		await this.subscriber.subscribe(channel);
		this.subscriber.on("message", (receivedChannel, message) => {
			if (receivedChannel === channel) {
				callback(message);
			}
		});

		logger.info("Subscribed to Redis channel", { channel });
	}

	async unsubscribe(channel: string): Promise<void> {
		if (!this.subscriber) {
			throw new Error("Redis subscriber not available");
		}

		await this.subscriber.unsubscribe(channel);
		logger.info("Unsubscribed from Redis channel", { channel });
	}

	async publish(channel: string, message: string): Promise<number> {
		if (!this.publisher || !this.isConnected) {
			throw new Error("Redis publisher not available");
		}

		const result = await this.publisher.publish(channel, message);
		logger.debug("Published message to Redis channel", {
			channel,
			message: message.substring(0, 100),
			subscribers: result,
		});

		return result;
	}

	async setWithExpiry(
		key: string,
		value: string,
		ttlSeconds: number
	): Promise<void> {
		if (!this.redis || !this.isConnected) {
			throw new Error("Redis not connected");
		}

		await this.redis.setex(key, ttlSeconds, value);
	}

	async get(key: string): Promise<string | null> {
		if (!this.redis || !this.isConnected) {
			throw new Error("Redis not connected");
		}

		return await this.redis.get(key);
	}

	async delete(key: string): Promise<number> {
		if (!this.redis || !this.isConnected) {
			throw new Error("Redis not connected");
		}

		return await this.redis.del(key);
	}

	async exists(key: string): Promise<boolean> {
		if (!this.redis || !this.isConnected) {
			throw new Error("Redis not connected");
		}

		const result = await this.redis.exists(key);
		return result === 1;
	}

	async hset(key: string, field: string, value: string): Promise<number> {
		if (!this.redis || !this.isConnected) {
			throw new Error("Redis not connected");
		}

		return await this.redis.hset(key, field, value);
	}

	async hget(key: string, field: string): Promise<string | null> {
		if (!this.redis || !this.isConnected) {
			throw new Error("Redis not connected");
		}

		return await this.redis.hget(key, field);
	}

	async hgetall(key: string): Promise<Record<string, string>> {
		if (!this.redis || !this.isConnected) {
			throw new Error("Redis not connected");
		}

		return await this.redis.hgetall(key);
	}
}

export default RedisConnectionManager;
