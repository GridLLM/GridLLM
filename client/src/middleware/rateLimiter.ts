import { Request, Response, NextFunction } from "express";
import { config } from "@/config";
import { logger } from "@/utils/logger";
import { createError } from "./errorHandler";

interface RateLimitStore {
	[key: string]: {
		count: number;
		resetTime: number;
	};
}

class InMemoryRateLimitStore {
	private store: RateLimitStore = {};

	get(key: string): { count: number; resetTime: number } | undefined {
		const record = this.store[key];
		if (!record) return undefined;

		// Clean up expired records
		if (Date.now() > record.resetTime) {
			delete this.store[key];
			return undefined;
		}

		return record;
	}

	set(key: string, count: number, resetTime: number): void {
		this.store[key] = { count, resetTime };
	}

	increment(key: string): number {
		const record = this.get(key);
		if (!record) {
			const resetTime = Date.now() + config.rateLimit.window;
			this.set(key, 1, resetTime);
			return 1;
		}

		record.count++;
		this.store[key] = record;
		return record.count;
	}

	cleanup(): void {
		const now = Date.now();
		Object.keys(this.store).forEach((key) => {
			if (this.store[key]?.resetTime && now > this.store[key].resetTime) {
				delete this.store[key];
			}
		});
	}
}

const store = new InMemoryRateLimitStore();

// Cleanup expired records every minute
setInterval(() => {
	store.cleanup();
}, 60000);

export const rateLimiter = (
	req: Request,
	res: Response,
	next: NextFunction
): void => {
	try {
		// Skip rate limiting for health checks
		if (req.path.startsWith("/health")) {
			return next();
		}

		// Create a unique key for the client
		const clientId = req.ip || "unknown";
		const key = `rate_limit:${clientId}`;

		// Get current count for this client
		const record = store.get(key);
		const now = Date.now();

		if (!record) {
			// First request from this client
			const resetTime = now + config.rateLimit.window;
			store.set(key, 1, resetTime);

			res.setHeader("X-RateLimit-Limit", config.rateLimit.maxRequests);
			res.setHeader("X-RateLimit-Remaining", config.rateLimit.maxRequests - 1);
			res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000));

			return next();
		}

		// Check if limit exceeded
		if (record.count >= config.rateLimit.maxRequests) {
			const retryAfter = Math.ceil((record.resetTime - now) / 1000);

			logger.warn("Rate limit exceeded", {
				clientId,
				count: record.count,
				limit: config.rateLimit.maxRequests,
				retryAfter,
			});

			res.setHeader("X-RateLimit-Limit", config.rateLimit.maxRequests);
			res.setHeader("X-RateLimit-Remaining", 0);
			res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetTime / 1000));
			res.setHeader("Retry-After", retryAfter);

			return next(
				createError("Too many requests, please try again later", 429)
			);
		}

		// Increment counter
		const newCount = store.increment(key);

		res.setHeader("X-RateLimit-Limit", config.rateLimit.maxRequests);
		res.setHeader(
			"X-RateLimit-Remaining",
			config.rateLimit.maxRequests - newCount
		);
		res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetTime / 1000));

		next();
	} catch (error) {
		logger.error("Rate limiter error", error);
		next();
	}
};
