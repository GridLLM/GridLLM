import winston from "winston";
import path from "path";
import fs from "fs";

// Ensure logs directory exists
const logDir = path.dirname("./logs/GridLLM-client.log");
if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir, { recursive: true });
}

// Safe JSON stringify function to handle circular references
const safeStringify = (obj: any, space?: number): string => {
	const seen = new WeakSet();
	return JSON.stringify(
		obj,
		(key, value) => {
			if (typeof value === "object" && value !== null) {
				if (seen.has(value)) {
					return "[Circular Reference]";
				}
				seen.add(value);
			}
			// Handle Error objects properly
			if (value instanceof Error) {
				return {
					name: value.name,
					message: value.message,
					stack: value.stack,
					...(value as any), // Include any additional properties
				};
			}
			return value;
		},
		space
	);
};

const logFormat = winston.format.combine(
	winston.format.timestamp({
		format: "YYYY-MM-DD HH:mm:ss",
	}),
	winston.format.errors({ stack: true }),
	winston.format.json(),
	winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
		let logMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;

		if (stack) {
			logMessage += `\n${stack}`;
		}

		if (Object.keys(meta).length > 0) {
			try {
				logMessage += `\n${safeStringify(meta, 2)}`;
			} catch (error) {
				logMessage += `\n[Error serializing metadata: ${
					error instanceof Error ? error.message : "Unknown error"
				}]`;
			}
		}

		return logMessage;
	})
);

export const logger = winston.createLogger({
	level: process.env.LOG_LEVEL || "info",
	format: logFormat,
	defaultMeta: { service: "GridLLM-client" },
	transports: [
		new winston.transports.File({
			filename: "./logs/error.log",
			level: "error",
			maxsize: 5242880, // 5MB
			maxFiles: 5,
		}),
		new winston.transports.File({
			filename: "./logs/GridLLM-client.log",
			maxsize: 5242880, // 5MB
			maxFiles: 5,
		}),
	],
});

// Add console transport in development
if (process.env.NODE_ENV !== "production") {
	logger.add(
		new winston.transports.Console({
			format: winston.format.combine(
				winston.format.colorize(),
				winston.format.simple(),
				winston.format.printf(({ timestamp, level, message, stack }) => {
					let logMessage = `${timestamp} [${level}]: ${message}`;
					if (stack) {
						logMessage += `\n${stack}`;
					}
					return logMessage;
				})
			),
		})
	);
}

export default logger;
